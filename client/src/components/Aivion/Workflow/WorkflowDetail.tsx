import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import type { Workflow, WorkflowInputField } from './types';

const SERVICE_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  google_drive: 'Google Drive',
  google_calendar: 'Google Calendar',
};

const STEP_BADGE: Record<string, string> = {
  llm: 'AI',
  file_extract: 'Extract',
  user_input: 'Review Gate',
  integration: 'Integration',
  loop: 'Loop',
  template: 'Template',
};

// ── FileInput ─────────────────────────────────────────────────────────────────

function FileInput({
  field,
  onChange,
  showValidation,
  token,
}: {
  field: WorkflowInputField;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
}) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [fileName, setFileName] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const showMissing = showValidation && status === 'idle';

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStatus('uploading');
    setErrMsg('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/aivion/workflow/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { storage_key } = await res.json();
      onChange(field.name, storage_key);
      setStatus('done');
    } catch {
      setStatus('error');
      setErrMsg('Upload failed. Please try again.');
    }
  }

  const border = showMissing
    ? 'border-red-400'
    : status === 'done'
      ? 'border-green-400'
      : 'border-border-light hover:border-border-medium';

  return (
    <div className="flex flex-col gap-1.5">
      <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed ${border} bg-surface-secondary px-4 py-3 text-sm text-text-secondary transition-colors`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="truncate">
          {status === 'uploading' ? 'Uploading…' : status === 'done' ? fileName : field.placeholder ?? 'Choose file'}
        </span>
        <input type="file" accept={field.accept ?? '.pdf'} className="sr-only" onChange={handleChange} disabled={status === 'uploading'} />
      </label>
      {status === 'done' && <p className="text-xs text-green-600">Uploaded successfully</p>}
      {status === 'error' && <p className="text-xs text-red-500">{errMsg}</p>}
      {showMissing && <p className="text-xs text-red-500">Please upload a file</p>}
    </div>
  );
}

// ── FileArrayInput ────────────────────────────────────────────────────────────

type UploadItem = {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  storageKey?: string;
};

function FileArrayInput({
  field,
  onChange,
  showValidation,
  token,
}: {
  field: WorkflowInputField;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
}) {
  const maxFiles = field.max_files ?? 10;
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const doneCount = items.filter((i) => i.status === 'done').length;
  const activeCount = items.filter((i) => i.status !== 'error').length;
  const showMissing = showValidation && doneCount === 0;
  const atMax = activeCount >= maxFiles;

  useEffect(() => {
    const keys = items.filter((i) => i.status === 'done').map((i) => i.storageKey!);
    onChangeRef.current(field.name, JSON.stringify(keys));
  }, [items, field.name]);

  const uploadFile = useCallback(async (file: File) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, name: file.name, status: 'uploading' }]);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/aivion/workflow/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { storage_key } = await res.json();
      setItems((prev) => prev.map((item) => item.id === id ? { ...item, status: 'done', storageKey: storage_key } : item));
    } catch {
      setItems((prev) => prev.map((item) => item.id === id ? { ...item, status: 'error' } : item));
    }
  }, [token]);

  function handleFiles(files: FileList | File[]) {
    const remaining = maxFiles - activeCount;
    Array.from(files).slice(0, remaining).forEach((f) => void uploadFile(f));
  }

  return (
    <div className="flex flex-col gap-3">
      {!atMax && (
        <label
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragging
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
              : showMissing
                ? 'border-red-400'
                : 'border-border-light hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) handleFiles(e.dataTransfer.files); }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-text-tertiary" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {dragging ? 'Drop files here' : 'Click or drag CVs here'}
            </p>
            <p className="text-xs text-text-tertiary">PDF or DOCX · up to {maxFiles} files · max 10 MB each</p>
          </div>
          <input
            type="file"
            multiple
            accept={field.accept ?? '.pdf,.docx'}
            className="sr-only"
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ''; }}
          />
        </label>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2.5 rounded-lg border border-border-light bg-surface-secondary px-3 py-2">
              {item.status === 'uploading' ? (
                <svg className="h-4 w-4 shrink-0 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : item.status === 'done' ? (
                <svg className="h-4 w-4 shrink-0 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="h-4 w-4 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{item.name}</span>
              <span className="shrink-0 text-xs text-text-tertiary">
                {item.status === 'uploading' ? 'Uploading…' : item.status === 'error' ? 'Failed' : ''}
              </span>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                className="shrink-0 rounded p-0.5 text-text-tertiary hover:bg-surface-hover hover:text-text-secondary"
                aria-label="Remove file"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        {showMissing
          ? <p className="text-xs text-red-500">Please upload at least one file</p>
          : <span />}
        {items.length > 0 && (
          <p className="text-xs text-text-tertiary">{doneCount} / {maxFiles} uploaded</p>
        )}
      </div>
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

const inputBase =
  'w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-amber-500/50 dark:border-border-medium';

function FormField({
  field,
  value,
  onChange,
  showValidation,
  token,
}: {
  field: WorkflowInputField;
  value: string;
  onChange: (name: string, value: string) => void;
  showValidation?: boolean;
  token: string | undefined;
}) {
  if (field.type === 'file') {
    return <FileInput field={field} onChange={onChange} showValidation={showValidation} token={token} />;
  }
  if (field.type === 'file_array') {
    return <FileArrayInput field={field} onChange={onChange} showValidation={showValidation} token={token} />;
  }

  const showError = showValidation && field.required && !value.trim();
  const errorClass = showError ? 'border-red-400 focus:ring-red-400/50' : '';
  const cls = `${inputBase} ${errorClass}`;

  let input: React.ReactNode;
  if (field.type === 'select' && field.options) {
    input = (
      <select className={cls} value={value} onChange={(e) => onChange(field.name, e.target.value)}>
        <option value="">Select…</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === 'text') {
    input = (
      <textarea rows={3} className={`${cls} resize-y`} value={value} onChange={(e) => onChange(field.name, e.target.value)} placeholder={field.placeholder} />
    );
  } else if (field.type === 'boolean') {
    input = (
      <input type="checkbox" className="h-4 w-4 rounded" checked={value === 'true'} onChange={(e) => onChange(field.name, String(e.target.checked))} />
    );
  } else {
    const typeMap: Record<string, string> = { string: 'text', email: 'email', number: 'number', date: 'date' };
    input = (
      <input type={typeMap[field.type] ?? 'text'} className={cls} value={value} onChange={(e) => onChange(field.name, e.target.value)} placeholder={field.placeholder} />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {input}
      {showError && <p className="text-xs text-red-500">This field is required</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuthContext();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showValidation, setShowValidation] = useState(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Live run state after "Start run"
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pendingStepId, setPendingStepId] = useState<string | null>(null);
  const [completedStepIds, setCompletedStepIds] = useState<Set<string>>(new Set());
  const [runStatus, setRunStatus] = useState<string>('pending');
  const sseAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    Promise.all([
      fetch('/api/aivion/workflow/workflows', {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Workflow[]>; }),
      fetch(`/api/aivion/workflow/workflows/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() as Promise<Workflow> : null)).catch(() => null),
    ])
      .then(([list, detail]) => {
        setWorkflows(list);
        const fromList = list.find((w) => w.id === id);
        const wf = detail ?? fromList;
        if (wf) {
          const init: Record<string, string> = {};
          for (const f of wf.spec?.inputs ?? []) init[f.name] = f.type === 'file_array' ? '[]' : '';
          setValues(init);
        }
        if (detail && fromList) {
          setWorkflows(list.map((w) =>
            w.id === id ? { ...fromList, ...detail, is_runnable: fromList.is_runnable, missing_connections: fromList.missing_connections } : w,
          ));
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id, token]);

  const workflow = workflows.find((w) => w.id === id);
  const steps = (workflow?.spec.steps ?? []).filter((s) => s.type !== 'scrub' && s.type !== 'unscrub');
  const inputs = workflow?.spec.inputs ?? [];

  // SSE stream — connect when activeRunId is set, navigate on terminal status
  useEffect(() => {
    if (!activeRunId || !token || !id) return;
    sseAbortRef.current?.abort();
    const controller = new AbortController();
    sseAbortRef.current = controller;
    let buf = '';

    fetch(`/api/aivion/workflow/runs/${activeRunId}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) { navigate(`/workflow/${id}/runs/${activeRunId}`); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              setRunStatus(data.status ?? 'running');
              setPendingStepId(data.pending_step_id ?? null);
              if (data.outputs?._completed_steps) {
                setCompletedStepIds(new Set(Object.keys(data.outputs._completed_steps)));
              }
              if (['awaiting_user', 'completed', 'failed', 'cancelled'].includes(data.status)) {
                navigate(`/workflow/${id}/runs/${activeRunId}`);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    }).catch((err) => {
      if ((err as Error).name !== 'AbortError' && activeRunId) {
        navigate(`/workflow/${id}/runs/${activeRunId}`);
      }
    });

    return () => controller.abort();
  }, [activeRunId, token, id, navigate]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const missingRequired = inputs.some((f) => {
      if (!f.required) return false;
      const v = valuesRef.current[f.name] ?? '';
      if (f.type === 'file') return !v;
      if (f.type === 'file_array') { try { return (JSON.parse(v) as string[]).length === 0; } catch { return true; } }
      return !v.trim();
    });
    if (missingRequired) { setShowValidation(true); return; }
    setSubmitting(true);
    setStartError(null);
    const parsed: Record<string, unknown> = {};
    for (const f of inputs) {
      const v = valuesRef.current[f.name] ?? '';
      if (f.type === 'number') parsed[f.name] = v === '' ? null : Number(v);
      else if (f.type === 'boolean') parsed[f.name] = v === 'true';
      else if (f.type === 'file_array') { try { parsed[f.name] = JSON.parse(v); } catch { parsed[f.name] = []; } }
      else parsed[f.name] = v;
    }
    try {
      const res = await fetch('/api/aivion/workflow/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workflow_id: id, inputs: parsed }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const { run_id } = await res.json();
      // Stay on this page — SSE will update the pipeline and navigate when ready
      setRunStatus('running');
      setActiveRunId(run_id);
      setSubmitting(false);
    } catch {
      setStartError('Failed to start workflow. Please try again.');
      setSubmitting(false);
    }
  }

  function getStepState(stepId: string): 'done' | 'running' | 'pending' {
    if (completedStepIds.has(stepId)) return 'done';
    if (pendingStepId === stepId) return 'running';
    // Before first SSE event, treat first uncompleted step as running
    if (activeRunId && runStatus === 'running' && !pendingStepId) {
      const firstUncompleted = steps.find((s) => !completedStepIds.has(s.id));
      if (firstUncompleted?.id === stepId) return 'running';
    }
    return 'pending';
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (loadError || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-base font-semibold text-text-primary">Workflow not found</p>
        <Link to="/workflow" className="text-sm text-amber-600 underline-offset-2 hover:underline">
          ← Back to workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-6 lg:p-10">
      {/* Back */}
      <Link to="/workflow" className="inline-flex shrink-0 items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        My Workflows
      </Link>

      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto lg:flex-row lg:overflow-hidden lg:gap-12">

        {/* ── Left: info + pipeline ── */}
        <div className="lg:w-56 lg:shrink-0 lg:overflow-y-auto">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <h1 className="text-xl font-bold text-text-primary">{workflow.name}</h1>
          {workflow.description && (
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{workflow.description}</p>
          )}
          {workflow.category && (
            <span className="mt-3 inline-block rounded-full bg-surface-secondary px-2.5 py-0.5 text-xs text-text-secondary">
              {workflow.category}
            </span>
          )}

          {steps.length > 0 && (
            <div className="mt-8">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Pipeline · {steps.length} {steps.length === 1 ? 'step' : 'steps'}
              </p>
              <ol className="space-y-0">
                {steps.map((step, i) => {
                  const state = getStepState(step.id);
                  return (
                    <li key={step.id} className="flex gap-3">
                      <div className="flex w-6 shrink-0 flex-col items-center">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[9px] font-bold transition-all ${
                          state === 'done'
                            ? 'border-green-500 bg-green-500 text-white'
                            : state === 'running'
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-border-light bg-surface-primary text-text-secondary'
                        }`}>
                          {state === 'done' ? (
                            <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          ) : state === 'running' ? (
                            <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
                          ) : (
                            i + 1
                          )}
                        </div>
                        {i < steps.length - 1 && (
                          <div className={`my-1 w-px flex-1 transition-colors ${state === 'done' ? 'bg-green-400' : 'bg-border-light'}`} style={{ minHeight: 12 }} />
                        )}
                      </div>
                      <div className={i < steps.length - 1 ? 'pb-4' : ''}>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          state === 'done' ? 'text-green-600 dark:text-green-400' :
                          state === 'running' ? 'text-blue-600 dark:text-blue-400' :
                          'text-amber-600 dark:text-amber-400'
                        }`}>
                          {STEP_BADGE[step.type] ?? step.type}
                        </span>
                        <p className={`text-sm leading-snug ${
                          state === 'done' ? 'font-normal text-text-secondary' :
                          state === 'running' ? 'font-semibold text-text-primary' :
                          'font-medium text-text-primary'
                        }`}>
                          {step.label ?? step.id.replace(/_/g, ' ')}
                        </p>
                        {state === 'running' && (
                          <p className="mt-0.5 text-xs text-blue-500 dark:text-blue-400 animate-pulse">Running…</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="hidden w-px self-stretch bg-border-light lg:block" />

        {/* ── Right: form or loader ── */}
        <div className="min-w-0 flex-1 pb-4 lg:overflow-y-auto lg:pb-0">
          {activeRunId ? (
            /* Pipeline is running — show current step loader */
            <div className="flex flex-col items-center justify-center gap-5 py-20">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <svg className="absolute inset-0 h-16 w-16 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-20" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-2xl">{workflow.icon ?? '⚡'}</span>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-text-primary">
                  {pendingStepId
                    ? (steps.find((s) => s.id === pendingStepId)?.label ?? pendingStepId.replace(/_/g, ' '))
                    : 'Starting…'}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {completedStepIds.size > 0
                    ? `${completedStepIds.size} of ${steps.length} steps complete`
                    : 'Preparing workflow…'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-text-primary">Start a new run</h2>
              <p className="mt-1 text-sm text-text-secondary">
                {inputs.length > 0 ? 'Fill in the details below, then click Start.' : 'This workflow requires no inputs — click Start to run it immediately.'}
              </p>

              {workflow.is_runnable === false && (workflow.missing_connections?.length ?? 0) > 0 && (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-700/40 dark:bg-amber-900/15">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Connect required services to run this workflow
                  </p>
                  <ul className="mt-2 space-y-1">
                    {(workflow.missing_connections ?? []).map((svc) => (
                      <li key={svc} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {SERVICE_LABELS[svc] ?? svc}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/connections"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"
                  >
                    Connect services
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              )}

              <form onSubmit={handleStart} className="mt-6 space-y-5">
                {startError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                    {startError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {inputs.map((f) => (
                    <div key={f.name} className={f.type === 'text' || f.type === 'file' || f.type === 'file_array' ? 'col-span-2' : 'col-span-1 max-sm:col-span-2'}>
                      <label className="mb-1.5 block text-sm font-medium text-text-primary">
                        {f.label}
                        {f.required && <span className="ml-1 text-red-500">*</span>}
                      </label>
                      <FormField
                        field={f}
                        value={values[f.name] ?? ''}
                        onChange={(name, val) => setValues((p) => ({ ...p, [name]: val }))}
                        showValidation={showValidation}
                        token={token}
                      />
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={submitting || workflow.is_runnable === false}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
                >
                  {submitting ? 'Starting…' : 'Start run'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
