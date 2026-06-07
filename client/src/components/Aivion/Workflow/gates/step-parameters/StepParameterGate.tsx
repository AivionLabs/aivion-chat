/* eslint-disable i18next/no-literal-string */
import { useEffect, useState } from 'react';
import type { StepParametersSchema, WorkflowRun } from '../../types';
import WorkflowInputForm from '../../WorkflowInputForm';
import {
  buildDefaultInputValues,
  buildRunInputSummary,
  getMissingRequiredInputs,
  validateRequiredInputs,
} from '../../workflow-input-utils';

interface Props {
  run: WorkflowRun;
  schema: StepParametersSchema;
  runId: string;
  token: string | undefined;
  onResumed: () => void;
  prefill?: Record<string, string>;
  prefillToken?: number;
}

function valuesFromRun(
  fields: StepParametersSchema['fields'],
  runInputs: Record<string, unknown>,
): Record<string, string> {
  const base = buildDefaultInputValues(fields);
  for (const field of fields) {
    const raw = runInputs[field.name];
    if (raw != null && String(raw).length > 0) {
      base[field.name] = String(raw);
    }
  }
  return base;
}

export default function StepParameterGate({
  run,
  schema,
  runId,
  token,
  onResumed,
  prefill,
  prefillToken,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    valuesFromRun(schema.fields, run.inputs ?? {}),
  );
  const [expanded, setExpanded] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  useEffect(() => {
    setValues(valuesFromRun(schema.fields, run.inputs ?? {}));
  }, [run.inputs, schema.fields]);

  useEffect(() => {
    if (!prefill || prefillToken == null) return;
    setValues((prev) => ({ ...prev, ...prefill }));
  }, [prefill, prefillToken]);

  const canRun = validateRequiredInputs(schema.fields, values);
  const missingRequired = getMissingRequiredInputs(schema.fields, values);
  const summary = buildRunInputSummary(schema.fields, values);
  const title = schema.title ?? schema.target_step_id.replace(/_/g, ' ');

  async function handleRun() {
    if (!validateRequiredInputs(schema.fields, values)) {
      setShowValidation(true);
      return;
    }
    setSubmitting(true);
    setResumeError(null);
    try {
      const parsed: Record<string, unknown> = {};
      for (const field of schema.fields) {
        const v = values[field.name] ?? '';
        if (field.type === 'number') parsed[field.name] = v === '' ? null : Number(v);
        else if (field.type === 'boolean') parsed[field.name] = v === 'true';
        else parsed[field.name] = v;
      }
      const res = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input: parsed }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(
          typeof err.detail === 'string'
            ? err.detail
            : typeof err.error === 'string'
              ? err.error
              : `Resume failed (${res.status})`,
        );
      }
      onResumed();
    } catch (e) {
      setResumeError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200/80 bg-surface-primary p-4 dark:border-amber-800/40">
      <div>
        <p
          className={
            canRun
              ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300'
              : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary'
          }
        >
          {canRun ? 'Ready to run' : 'Setup required'}
        </p>
        <p className="mt-1 text-sm font-medium text-text-primary">{title}</p>
        {schema.description && (
          <p className="mt-1 text-xs text-text-secondary">{schema.description}</p>
        )}
        <p className="mt-1 text-xs text-text-secondary">
          {canRun
            ? 'Review settings below, then click Run. Chat can update values before you commit.'
            : 'Fill required fields via Update settings or paste them in chat.'}
        </p>
      </div>

      {!expanded && (
        <ul className="space-y-1">
          {summary.map((line) => {
            const isMissing = line.startsWith('Still needed:');
            return (
              <li
                key={line}
                className={`flex items-start gap-2 text-xs ${isMissing ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-text-secondary'}`}
              >
                <span
                  className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${isMissing ? 'bg-amber-600' : 'bg-amber-500'}`}
                />
                <span>{line}</span>
              </li>
            );
          })}
        </ul>
      )}

      {expanded && (
        <WorkflowInputForm
          fields={schema.fields}
          values={values}
          onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
          showValidation={showValidation}
          token={token}
          compact
        />
      )}

      {resumeError && (
        <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {resumeError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={submitting || !canRun}
          title={
            !canRun && missingRequired.length > 0
              ? `Required: ${missingRequired.map((f) => f.label).join(', ')}`
              : undefined
          }
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          disabled={submitting}
          className="rounded-lg border border-border-light bg-surface-primary px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-50"
        >
          {expanded ? 'Hide settings' : 'Update settings'}
        </button>
      </div>
    </div>
  );
}
