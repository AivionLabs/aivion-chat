import { completedStepMap } from './helpers';
import type { WorkflowInputField, WorkflowRun, WorkflowStep } from './types';

export type RunTimelineItemKind = 'meta' | 'inputs' | 'step' | 'audit';

export type RunTimelineItem = {
  id: string;
  kind: RunTimelineItemKind;
  title: string;
  description?: string;
  timestamp?: string;
  details?: Array<{ label: string; value: string }>;
  tone?: 'default' | 'success' | 'warning' | 'muted';
};

export type WorkflowPlayEvent = {
  id: string;
  step_id: string;
  record_id: string;
  action: string;
  instructions?: string | null;
  created_at: string;
};

const HIDDEN_INPUT_KEYS = new Set(['model', 'org_id', 'clerk_user_id']);

const METRIC_FIELDS: Array<[string, string]> = [
  ['items_inserted', 'Items fetched'],
  ['rows_unique', 'Unique records'],
  ['rows_deduplicated', 'Duplicates removed'],
  ['clusters_created', 'Clusters created'],
  ['scored_items', 'Items scored'],
  ['selected_count', 'Stories selected'],
  ['records_researched', 'Stories researched'],
  ['drafts_created', 'Drafts created'],
  ['revisions_applied', 'Revisions applied'],
  ['drafts_revised', 'Drafts revised'],
  ['publication_status', 'Publication status'],
  ['dispatch_status', 'Dispatch status'],
  ['endpoint_url', 'Dispatch endpoint'],
];

function formatTimestamp(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDurationMs(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatDecision(value: unknown): string {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeHumanOutput(output: Record<string, unknown>): {
  description: string;
  details: Array<{ label: string; value: string }>;
  tone: RunTimelineItem['tone'];
} {
  const details: Array<{ label: string; value: string }> = [];
  const selections = output.selections;
  if (Array.isArray(selections) && selections.length > 0) {
    details.push({ label: 'Selected', value: `${selections.length} item(s)` });
  }
  if (typeof output.editor_notes === 'string' && output.editor_notes.trim()) {
    details.push({ label: 'Editor notes', value: output.editor_notes.trim() });
  }
  if (typeof output.decision === 'string' && output.decision.trim()) {
    details.push({ label: 'Decision', value: formatDecision(output.decision) });
  }
  if (typeof output.revision_notes === 'string' && output.revision_notes.trim()) {
    details.push({ label: 'Revision notes', value: output.revision_notes.trim() });
  }
  if (typeof output.notes === 'string' && output.notes.trim()) {
    details.push({ label: 'Notes', value: output.notes.trim() });
  }

  const decision = String(output.decision ?? '').toLowerCase();
  const tone: RunTimelineItem['tone'] =
    decision === 'reject' || decision === 'deny'
      ? 'warning'
      : decision === 'approve' || decision === 'handoff' || decision === 'publish'
        ? 'success'
        : 'default';

  const description =
    details.length > 0
      ? details.map((entry) => `${entry.label}: ${entry.value}`).join(' · ')
      : 'Review submitted';

  return { description, details, tone };
}

function summarizeAutomatedOutput(output: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [field, label] of METRIC_FIELDS) {
    const value = output[field];
    if (value == null || value === '') continue;
    parts.push(`${label}: ${String(value)}`);
  }

  const artifact = asRecord(output.artifact);
  if (artifact?.file_name) {
    parts.push(`Artifact: ${String(artifact.file_name)}`);
  } else if (artifact?.row_count != null) {
    parts.push(`Rows: ${String(artifact.row_count)}`);
  }

  if (output.replayed_step === true) {
    parts.push('Reused prior run output');
  }

  return parts.join(' · ') || 'Step completed';
}

function stepWasReached(
  stepIndex: number,
  steps: WorkflowStep[],
  done: Record<string, { output: unknown }>,
): boolean {
  return steps.slice(stepIndex + 1).some((later) => Boolean(done[later.id]));
}

function buildInputItems(
  run: WorkflowRun,
  inputFields: WorkflowInputField[] | undefined,
): RunTimelineItem | null {
  const inputs = run.inputs ?? {};
  const details: Array<{ label: string; value: string }> = [];

  if (inputFields?.length) {
    for (const field of inputFields) {
      const raw = inputs[field.name];
      if (raw == null || raw === '') continue;
      const value =
        typeof raw === 'string'
          ? raw.length > 180
            ? `${raw.slice(0, 177)}…`
            : raw
          : JSON.stringify(raw);
      details.push({ label: field.label || field.name, value });
    }
  } else {
    for (const [key, raw] of Object.entries(inputs)) {
      if (HIDDEN_INPUT_KEYS.has(key) || raw == null || raw === '') continue;
      details.push({
        label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value: typeof raw === 'string' ? raw : JSON.stringify(raw),
      });
    }
  }

  if (!details.length) return null;

  return {
    id: 'run-inputs',
    kind: 'inputs',
    title: 'Run inputs',
    description: `${details.length} configured value${details.length === 1 ? '' : 's'}`,
    details,
    tone: 'muted',
  };
}

export function buildCompletedRunTimeline(
  run: WorkflowRun,
  steps: WorkflowStep[],
  playEvents: WorkflowPlayEvent[] = [],
  inputFields?: WorkflowInputField[],
): RunTimelineItem[] {
  if (run.status !== 'completed') return [];

  const items: RunTimelineItem[] = [];
  const done = completedStepMap(run);
  const startedAt = run.started_at ?? run.created_at;
  const completedAt = run.completed_at;
  const durationMs =
    startedAt && completedAt
      ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
      : null;

  items.push({
    id: 'run-complete',
    kind: 'meta',
    title: 'Run completed',
    description: durationMs != null ? `Duration ${formatDurationMs(durationMs)}` : undefined,
    timestamp: formatTimestamp(completedAt ?? undefined),
    tone: 'success',
  });

  const inputItem = buildInputItems(run, inputFields);
  if (inputItem) items.push(inputItem);

  steps.forEach((step, index) => {
    if (!step.id || step.id.endsWith('_params')) return;

    const rawOutput = done[step.id]?.output;
    const output = asRecord(rawOutput);

    if (!output) {
      if (stepWasReached(index, steps, done)) {
        items.push({
          id: `step-${step.id}`,
          kind: 'step',
          title: step.label ?? step.id.replace(/_/g, ' '),
          description: 'Completed (details not stored on run snapshot)',
          tone: 'muted',
        });
      }
      return;
    }

    if (step.type === 'user_input') {
      const human = summarizeHumanOutput(output);
      items.push({
        id: `step-${step.id}`,
        kind: 'step',
        title: step.label ?? step.id.replace(/_/g, ' '),
        description: human.description,
        details: human.details,
        tone: human.tone,
      });
      return;
    }

    const hasDecision =
      typeof output.decision === 'string' && String(output.decision).trim().length > 0;
    if (hasDecision && (output.revision_notes != null || output.notes != null)) {
      const human = summarizeHumanOutput(output);
      items.push({
        id: `step-${step.id}`,
        kind: 'step',
        title: step.label ?? step.id.replace(/_/g, ' '),
        description: human.description,
        details: human.details,
        tone: human.tone,
      });
      return;
    }

    items.push({
      id: `step-${step.id}`,
      kind: 'step',
      title: step.label ?? step.id.replace(/_/g, ' '),
      description: summarizeAutomatedOutput(output),
      tone: 'default',
    });
  });

  for (const event of playEvents) {
    const instruction =
      typeof event.instructions === 'string' && event.instructions.trim()
        ? event.instructions.trim()
        : undefined;
    items.push({
      id: `audit-${event.id}`,
      kind: 'audit',
      title: 'Article regenerated during review',
      description: instruction,
      timestamp: formatTimestamp(event.created_at),
      details: [
        { label: 'Step', value: event.step_id },
        { label: 'Record', value: event.record_id },
        { label: 'Action', value: event.action },
      ],
      tone: 'warning',
    });
  }

  return items;
}
