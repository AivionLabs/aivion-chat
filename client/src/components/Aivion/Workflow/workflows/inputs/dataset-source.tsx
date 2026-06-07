import { useEffect, useMemo, useState } from 'react';
import type { WorkflowInputField, WorkflowRun } from '../../types';

type Props = {
  field: WorkflowInputField;
  formatFieldName?: string;
  value: string;
  token: string | undefined;
  showValidation?: boolean;
  workflowNamesById: Record<string, string>;
  onChange: (name: string, value: string) => void;
  textFieldValue?: string;
  onTextFieldsChange?: (value: string) => void;
  onDetected?: (meta: { sourceFormat: 'csv' | 'json'; columns: string[]; recommendedTextFields: string[] }) => void;
};

type SourceMode = 'recent' | 'upload';

type DatasetArtifact = {
  runId: string;
  workflowId: string;
  workflowName: string;
  stepId: string;
  storageKey: string;
  fileName: string;
  contentType?: string;
  sourceFormat?: 'csv' | 'json';
  createdAt?: string | null;
};

type RecentRunSummary = {
  id: string;
  workflow_id: string;
  outputs?: Record<string, unknown>;
  created_at?: string | null;
};

const inputBase =
  'w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-amber-500/50 dark:border-border-medium';

function inferSourceFormat(fileName?: string, contentType?: string): 'csv' | 'json' | undefined {
  const normalizedName = String(fileName ?? '').toLowerCase();
  const normalizedType = String(contentType ?? '').toLowerCase();
  if (normalizedName.endsWith('.csv') || normalizedType.includes('text/csv')) return 'csv';
  if (normalizedName.endsWith('.json') || normalizedType.includes('application/json')) return 'json';
  return undefined;
}

function extractDatasetArtifacts(
  run: Pick<WorkflowRun, 'run_id' | 'workflow_id' | 'outputs' | 'created_at'>,
  workflowNamesById: Record<string, string>,
): DatasetArtifact[] {
  const completedSteps = (run.outputs?.['_completed_steps'] ?? {}) as Record<string, { output?: Record<string, unknown> }>;
  return Object.entries(completedSteps).flatMap(([stepId, stepData]) => {
    const output = stepData?.output ?? {};
    const artifact = output.artifact && typeof output.artifact === 'object'
      ? output.artifact as Record<string, unknown>
      : null;
    const storageKey = typeof output.storage_key === 'string'
      ? output.storage_key
      : typeof artifact?.storage_key === 'string'
        ? artifact.storage_key
        : '';
    if (!storageKey) return [];

    const fileName = typeof output.file_name === 'string' && output.file_name.trim()
      ? output.file_name
      : typeof artifact?.file_name === 'string' && artifact.file_name.trim()
        ? artifact.file_name
        : `${stepId}.csv`;
    const contentType = typeof output.content_type === 'string' && output.content_type
      ? output.content_type
      : typeof artifact?.content_type === 'string'
        ? artifact.content_type
        : undefined;
    const sourceFormat = inferSourceFormat(fileName, contentType);
    if (!sourceFormat) return [];

    return [{
      runId: run.run_id,
      workflowId: run.workflow_id,
      workflowName: workflowNamesById[run.workflow_id] ?? 'Workflow run',
      stepId,
      storageKey,
      fileName,
      contentType,
      sourceFormat,
      createdAt: run.created_at ?? null,
    }];
  });
}

export default function DatasetSourceField({
  field,
  formatFieldName,
  value,
  token,
  showValidation,
  workflowNamesById,
  onChange,
  textFieldValue,
  onTextFieldsChange,
  onDetected,
}: Props) {
  const [sourceMode, setSourceMode] = useState<SourceMode>('recent');
  const [artifacts, setArtifacts] = useState<DatasetArtifact[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [inspectError, setInspectError] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [recommendedTextFields, setRecommendedTextFields] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    setLoadingRuns(true);
    setRunsError(null);
    let cancelled = false;
    async function loadArtifacts() {
      try {
        const listResponse = await fetch('/api/aivion/workflow/runs?limit=50', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!listResponse.ok) throw new Error(`${listResponse.status}`);
        const summaries = await listResponse.json() as RecentRunSummary[];
        const candidates = Array.isArray(summaries) ? summaries.slice(0, 50) : [];
        if (cancelled) return;
        setArtifacts(
          candidates.flatMap((summary) => extractDatasetArtifacts({
            run_id: summary.id,
            workflow_id: summary.workflow_id,
            outputs: summary.outputs ?? null,
            created_at: summary.created_at ?? null,
          }, workflowNamesById)),
        );
      } catch {
        if (cancelled) return;
        setArtifacts([]);
        setRunsError('Could not load recent workflow files.');
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    }
    void loadArtifacts();
    return () => {
      cancelled = true;
    };
  }, [token, workflowNamesById]);

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.storageKey === value) ?? null,
    [artifacts, value],
  );

  useEffect(() => {
    if (!value) {
      setSourceMode('recent');
      return;
    }
    if (selectedArtifact) {
      setSourceMode('recent');
      setUploadedFileName('');
      setUploadStatus('idle');
      return;
    }
    setSourceMode('upload');
  }, [selectedArtifact, value]);

  function applyFormat(format: 'csv' | 'json' | undefined) {
    if (!formatFieldName || !format) return;
    onChange(formatFieldName, format);
  }

  const selectedTextFields = useMemo(
    () => String(textFieldValue ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    [textFieldValue],
  );

  function toggleTextField(column: string) {
    const next = selectedTextFields.includes(column)
      ? selectedTextFields.filter((value) => value !== column)
      : [...selectedTextFields, column];
    onTextFieldsChange?.(next.join(','));
  }

  async function inspectDataset(storageKey: string, explicitFormat?: 'csv' | 'json') {
    if (!token || !storageKey) return;
    setInspecting(true);
    setInspectError('');
    try {
      const response = await fetch('/api/aivion/workflow/datasets/inspect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storage_key: storageKey,
          source_format: explicitFormat,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      const sourceFormat = (data as { source_format?: 'csv' | 'json' }).source_format ?? explicitFormat;
      const columns = Array.isArray((data as { columns?: string[] }).columns) ? (data as { columns: string[] }).columns : [];
      const recommended = Array.isArray((data as { recommended_text_fields?: string[] }).recommended_text_fields)
        ? (data as { recommended_text_fields: string[] }).recommended_text_fields
        : [];
      setDetectedColumns(columns);
      setRecommendedTextFields(recommended);
      if (sourceFormat) applyFormat(sourceFormat);
      onDetected?.({
        sourceFormat: sourceFormat ?? 'json',
        columns,
        recommendedTextFields: recommended,
      });
    } catch (error) {
      setDetectedColumns([]);
      setRecommendedTextFields([]);
      setInspectError(error instanceof Error ? error.message : 'Could not inspect dataset columns.');
    } finally {
      setInspecting(false);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    setUploadStatus('uploading');
    setUploadError('');

    const form = new FormData();
    form.append('file', file);

    try {
      const response = await fetch('/api/aivion/workflow/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json() as { storage_key: string };
      onChange(field.name, data.storage_key);
      const inferredFormat = inferSourceFormat(file.name, file.type);
      applyFormat(inferredFormat);
      await inspectDataset(data.storage_key, inferredFormat);
      setUploadStatus('done');
    } catch {
      setUploadStatus('error');
      setUploadError('Upload failed. Please try again.');
    } finally {
      event.currentTarget.value = '';
    }
  }

  const showMissing = Boolean(showValidation && field.required && !value.trim());

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">
          Source Dataset
          {field.required && <span className="ml-1 text-red-500">*</span>}
        </label>
        <p className="text-sm text-text-secondary">
          Choose a file from a previous workflow run or upload a CSV/JSON dataset.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setSourceMode('recent')}
          className={`rounded-xl border px-4 py-3 text-left transition-colors ${
            sourceMode === 'recent'
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20'
              : 'border-border-light bg-surface-primary hover:bg-surface-hover'
          }`}
        >
          <p className="text-sm font-semibold text-text-primary">Previous workflow file</p>
          <p className="mt-1 text-xs text-text-secondary">Reuse a CSV or JSON artifact from your recent runs.</p>
        </button>
        <button
          type="button"
          onClick={() => setSourceMode('upload')}
          className={`rounded-xl border px-4 py-3 text-left transition-colors ${
            sourceMode === 'upload'
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20'
              : 'border-border-light bg-surface-primary hover:bg-surface-hover'
          }`}
        >
          <p className="text-sm font-semibold text-text-primary">Upload file</p>
          <p className="mt-1 text-xs text-text-secondary">Upload a local CSV or JSON dataset for clustering.</p>
        </button>
      </div>

      {sourceMode === 'recent' ? (
        <div className="space-y-3 rounded-xl border border-border-light bg-surface-primary p-4">
          {loadingRuns ? (
            <p className="text-sm text-text-secondary">Loading recent workflow files…</p>
          ) : runsError ? (
            <p className="text-sm text-red-500">{runsError}</p>
          ) : artifacts.length === 0 ? (
            <p className="text-sm text-text-secondary">No CSV or JSON artifacts found in your recent workflow runs.</p>
          ) : (
            <>
              <select
                className={`${inputBase} ${showMissing ? 'border-red-400 focus:ring-red-400/50' : ''}`}
                value={value}
                onChange={(event) => {
                  const next = artifacts.find((artifact) => artifact.storageKey === event.target.value);
                  onChange(field.name, event.target.value);
                  applyFormat(next?.sourceFormat);
                  setUploadStatus('idle');
                  setUploadedFileName('');
                  setInspectError('');
                  if (next?.storageKey) {
                    void inspectDataset(next.storageKey, next.sourceFormat);
                  } else {
                    setDetectedColumns([]);
                    setRecommendedTextFields([]);
                  }
                }}
              >
                <option value="">Select a dataset…</option>
                {artifacts.map((artifact) => (
                  <option key={`${artifact.runId}:${artifact.stepId}:${artifact.storageKey}`} value={artifact.storageKey}>
                    {artifact.fileName} · {artifact.workflowName}
                  </option>
                ))}
              </select>

              {selectedArtifact && (
                <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-3 text-sm text-text-secondary">
                  <p className="font-medium text-text-primary">{selectedArtifact.fileName}</p>
                  <p className="mt-1">
                    {selectedArtifact.workflowName} · {selectedArtifact.stepId}
                    {selectedArtifact.createdAt ? ` · ${new Date(selectedArtifact.createdAt).toLocaleString()}` : ''}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border-light bg-surface-primary p-4">
          <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed ${
            showMissing ? 'border-red-400' : 'border-border-light hover:border-border-medium'
          } bg-surface-secondary px-4 py-3 text-sm text-text-secondary transition-colors`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate">
              {uploadStatus === 'uploading'
                ? 'Uploading…'
                : uploadedFileName || 'Choose a CSV or JSON file'}
            </span>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              onChange={(event) => void handleUpload(event)}
              disabled={uploadStatus === 'uploading'}
            />
          </label>
          {uploadStatus === 'done' && uploadedFileName && (
            <p className="text-xs text-green-600">Uploaded {uploadedFileName}</p>
          )}
          {uploadStatus === 'error' && <p className="text-xs text-red-500">{uploadError}</p>}
        </div>
      )}

      {showMissing && (
        <p className="text-xs text-red-500">Choose a previous workflow file or upload a dataset.</p>
      )}
      {(inspecting || inspectError || detectedColumns.length > 0) && (
        <div className="rounded-xl border border-border-light bg-surface-primary p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Detected columns
          </p>
          {inspecting ? (
            <p className="mt-2 text-sm text-text-secondary">Inspecting dataset…</p>
          ) : inspectError ? (
            <p className="mt-2 text-sm text-red-500">{inspectError}</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {detectedColumns.map((column) => (
                  <button
                    type="button"
                    key={column}
                    onClick={() => toggleTextField(column)}
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      selectedTextFields.includes(column)
                        ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-300'
                        : recommendedTextFields.includes(column)
                          ? 'bg-surface-secondary text-text-primary'
                          : 'bg-surface-secondary text-text-secondary'
                    }`}
                  >
                    {column}
                  </button>
                ))}
              </div>
              {recommendedTextFields.length > 0 && (
                <p className="mt-3 text-xs text-text-secondary">
                  Recommended text fields: {recommendedTextFields.join(', ')}
                </p>
              )}
              <p className="mt-2 text-xs text-text-secondary">
                Click columns to include or remove them from clustering.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
