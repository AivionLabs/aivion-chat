import type { WorkflowRun, WorkflowStep } from './types';

/** Must match aivion-workflow/workflow/workers/rss_fetch.py RSS_EMPTY_TERMINATION_MESSAGE */
export const RSS_EMPTY_TERMINATION_MESSAGE = 'No article found, terminating this workflow';

export function isRssEmptyTermination(errorMessage?: string | null): boolean {
  return Boolean(errorMessage?.includes(RSS_EMPTY_TERMINATION_MESSAGE));
}

export function formatWorkflowFailureMilestone(errorMessage?: string | null): string {
  if (isRssEmptyTermination(errorMessage)) {
    return RSS_EMPTY_TERMINATION_MESSAGE;
  }
  return errorMessage ? `Workflow run failed: ${errorMessage}` : 'Workflow run failed.';
}

export type CompletedStepEntry = {
  output?: unknown;
  completed_at?: string;
};

export function completedStepMap(run: WorkflowRun): Record<string, CompletedStepEntry> {
  return (run.outputs?.['_completed_steps'] ?? {}) as Record<string, CompletedStepEntry>;
}

export function formatStepDurationMs(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatRunDurationMs(run: WorkflowRun): string | null {
  const start = run.started_at ?? run.created_at;
  const end = run.completed_at;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return formatStepDurationMs(ms);
}

/** Per-step wall time from the prior step completion (or run start) to this step's completion. */
export function buildStepDurationMsMap(
  run: WorkflowRun,
  steps: WorkflowStep[],
): Record<string, number> {
  const visible = steps.filter((s) => s.id);
  const entries = completedStepMap(run);
  const runStart = new Date(run.started_at ?? run.created_at ?? '').getTime();
  const durations: Record<string, number> = {};
  let prevEnd = Number.isFinite(runStart) ? runStart : null;

  for (const step of visible) {
    const completedAt = entries[step.id]?.completed_at;
    if (!completedAt || prevEnd == null) {
      if (completedAt) {
        const end = new Date(completedAt).getTime();
        if (!Number.isNaN(end)) prevEnd = end;
      }
      continue;
    }
    const end = new Date(completedAt).getTime();
    if (Number.isNaN(end)) continue;
    durations[step.id] = Math.max(0, end - prevEnd);
    prevEnd = end;
  }

  return durations;
}

export type WorkflowStepVisualState =
  | 'done'
  | 'running'
  | 'review'
  | 'pending'
  | 'failed'
  | 'cancelled';

/** Canonical automated step id while a parameter or review gate is pending. */
export function resolvePendingTargetStepId(run: WorkflowRun): string | null {
  if (run.pending_target_step_id) return run.pending_target_step_id;
  const schema = run.pending_input_schema;
  if (schema?.type === 'step_parameters' && 'target_step_id' in schema) {
    return String(schema.target_step_id);
  }
  const pid = run.pending_step_id;
  if (!pid) return null;
  const paramsMatch = pid.match(/^(.+)_params(?:_ref)?$/);
  if (paramsMatch) return paramsMatch[1];
  return pid.replace(/_ref$/, '');
}

/** Derive per-step visual state from run snapshot (pending_step_id = current step). */
export function getWorkflowStepState(
  run: WorkflowRun,
  stepId: string,
  done: Record<string, CompletedStepEntry> = completedStepMap(run),
): WorkflowStepVisualState {
  if (done[stepId]) return 'done';
  const failedStepId = run.failed_step_id;
  if (run.status === 'completed' && !failedStepId) return 'done';
  if (run.status === 'failed' && failedStepId === stepId) return 'failed';
  const targetId = resolvePendingTargetStepId(run);
  if (run.pending_step_id === stepId || targetId === stepId) {
    if (run.status === 'failed') return 'failed';
    if (run.status === 'cancelled') return 'cancelled';
    if (run.status === 'awaiting_user') return 'review';
    if (run.status === 'running' || run.status === 'scheduled') return 'running';
  }
  return 'pending';
}

export function workflowStepProgress(
  run: WorkflowRun,
  steps: WorkflowStep[],
): {
  doneCount: number;
  total: number;
  currentStepId: string | null;
  currentLabel: string | null;
} {
  const done = completedStepMap(run);
  const visible = steps.filter((s) => s.id);
  const total = visible.length;
  const doneCount = visible.filter((s) => Boolean(done[s.id])).length;
  const currentStepId = resolvePendingTargetStepId(run) ?? run.pending_step_id ?? null;
  const current = currentStepId ? visible.find((s) => s.id === currentStepId) : undefined;
  const currentLabel = current
    ? current.label ?? current.id.replace(/_/g, ' ')
    : run.status === 'completed'
      ? null
      : null;
  return { doneCount, total, currentStepId, currentLabel };
}

export const STEP_CHIP_CLASS: Record<WorkflowStepVisualState, string> = {
  done: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800/50 dark:bg-green-950/30 dark:text-green-300',
  running:
    'border-amber-300 bg-amber-50 text-amber-800 ring-1 ring-amber-400/60 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  review:
    'border-purple-300 bg-purple-50 text-purple-800 ring-1 ring-purple-400/60 dark:border-purple-700 dark:bg-purple-950/30 dark:text-purple-300',
  pending: 'border-border-light bg-surface-secondary text-text-tertiary',
  failed:
    'border-red-300 bg-red-50 text-red-800 ring-1 ring-red-400/60 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300',
  cancelled: 'border-border-light bg-surface-secondary text-text-tertiary line-through opacity-60',
};

export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function resolveTemplate(
  template: string,
  completedSteps: Record<string, { output: unknown }>,
  inputs: Record<string, unknown> = {},
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
    if (path.startsWith('inputs.')) {
      return String(inputs[path.slice('inputs.'.length)] ?? '');
    }
    if (path.startsWith('steps.')) {
      const parts = path.slice('steps.'.length).split('.');
      let value: unknown = completedSteps;
      for (const part of parts) {
        if (value == null || typeof value !== 'object') return '';
        const m = part.match(/^([^\[]*)\[(\d+)\]$/);
        if (m) {
          const key = m[1];
          const idx = parseInt(m[2], 10);
          if (key) value = (value as Record<string, unknown>)[key];
          if (!Array.isArray(value)) return '';
          value = (value as unknown[])[idx];
        } else {
          value = (value as Record<string, unknown>)[part];
        }
      }
      if (Array.isArray(value)) return JSON.stringify(value);
      return value != null ? String(value) : '';
    }
    const [stepId, ...rest] = path.split('.');
    const out = completedSteps[stepId]?.output;
    return out ? String((out as Record<string, unknown>)[rest.join('.')] ?? '') : '';
  });
}

export function formatMetric(value: string, format?: string): string {
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return value;
  if (format === 'currency') return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (format === 'percent') return `${num}%`;
  if (format === 'number') return num.toLocaleString();
  return value;
}

export function resolveJsonArray(
  tpl: string,
  completedSteps: Record<string, { output: unknown }>,
  inputs: Record<string, unknown>,
): Record<string, unknown>[] {
  const raw = resolveTemplate(tpl, completedSteps, inputs);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  } catch { /* fall through */ }
  return [];
}

export function splitDots(val: string | undefined): string[] {
  if (!val || val === '—') return [];
  return val.replace(/ …$/, '').split(' · ').filter(Boolean);
}

export function getNested(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}
