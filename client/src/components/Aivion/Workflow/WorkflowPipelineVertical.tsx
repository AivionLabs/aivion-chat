/* eslint-disable i18next/no-literal-string */
import { cn } from '~/utils';
import {
  buildStepDurationMsMap,
  completedStepMap,
  formatRunDurationMs,
  formatStepDurationMs,
  getWorkflowStepState,
  type WorkflowStepVisualState,
} from './helpers';
import type { Workflow, WorkflowRun, WorkflowStep } from './types';

const STEP_BADGE: Record<string, string> = {
  llm: 'AI',
  file_extract: 'Extract',
  user_input: 'Review Gate',
  rss_fetch: 'RSS Fetch',
  deduplicate_records: 'Dedupe',
  cluster_records: 'Cluster',
  score_items: 'Score',
  draft_articles: 'Draft',
  revise_articles: 'Revise',
  package_publication: 'Package',
  publish_publication_http: 'Dispatch',
  integration: 'Integration',
  loop: 'Loop',
  template: 'Template',
};

const NODE_CLASS: Record<WorkflowStepVisualState, string> = {
  done: 'border-green-500 bg-green-500 text-white',
  running: 'border-blue-500 bg-blue-50 dark:bg-blue-900/30',
  review: 'border-purple-500 bg-purple-50 dark:bg-purple-900/30',
  failed: 'border-red-500 bg-red-50 dark:bg-red-900/30',
  cancelled: 'border-border-light bg-surface-primary text-text-secondary',
  pending: 'border-border-light bg-surface-primary text-text-secondary',
};

const BADGE_CLASS: Record<WorkflowStepVisualState, string> = {
  done: 'text-green-600 dark:text-green-400',
  running: 'text-blue-600 dark:text-blue-400',
  review: 'text-purple-600 dark:text-purple-400',
  failed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-text-tertiary',
  pending: 'text-amber-600 dark:text-amber-400',
};

const LABEL_CLASS: Record<WorkflowStepVisualState, string> = {
  done: 'font-normal text-text-secondary',
  running: 'font-semibold text-text-primary',
  review: 'font-semibold text-text-primary',
  failed: 'font-semibold text-text-primary',
  cancelled: 'font-normal text-text-secondary line-through opacity-70',
  pending: 'font-medium text-text-primary',
};

const CONNECTOR_CLASS: Record<WorkflowStepVisualState, string> = {
  done: 'bg-green-400',
  running: 'bg-border-light',
  review: 'bg-border-light',
  failed: 'bg-border-light',
  cancelled: 'bg-border-light',
  pending: 'bg-border-light',
};

interface Props {
  run: WorkflowRun;
  steps: WorkflowStep[];
  workflow?: Workflow | null;
  /** When false, only the step list is rendered (caller supplies title/context). */
  showWorkflowMeta?: boolean;
  /** Live per-step durations captured during an in-flight run (ms). */
  liveStepDurationsMs?: Record<string, number>;
  className?: string;
}

export default function WorkflowPipelineVertical({
  run,
  steps,
  workflow,
  showWorkflowMeta = true,
  liveStepDurationsMs,
  className,
}: Props) {
  const done = completedStepMap(run);
  const visible = steps.filter((step) => step.id);
  const persistedDurations = buildStepDurationMsMap(run, steps);
  const stepDurationsMs = { ...liveStepDurationsMs, ...persistedDurations };
  const totalDuration = run.status === 'completed' ? formatRunDurationMs(run) : null;

  if (visible.length === 0) return null;

  return (
    <div className={cn(className)}>
      {showWorkflowMeta && workflow?.name && (
        <h2 className="text-lg font-bold text-text-primary">{workflow.name}</h2>
      )}
      {showWorkflowMeta && workflow?.description && (
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{workflow.description}</p>
      )}
      {showWorkflowMeta && workflow?.category && (
        <span className="mt-3 inline-block rounded-full bg-surface-secondary px-2.5 py-0.5 text-xs text-text-secondary">
          {workflow.category}
        </span>
      )}

      <div className={showWorkflowMeta && workflow?.name ? 'mt-8' : ''}>
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Pipeline · {visible.length} {visible.length === 1 ? 'step' : 'steps'}
          </p>
          {totalDuration && (
            <p className="shrink-0 text-[10px] tabular-nums text-text-tertiary">{totalDuration}</p>
          )}
        </div>
        <ol className="space-y-0">
          {visible.map((step, i) => {
            const state = getWorkflowStepState(run, step.id, done);
            const durationMs = stepDurationsMs[step.id];
            const durationLabel =
              state === 'done' && durationMs != null ? formatStepDurationMs(durationMs) : null;
            const badge = STEP_BADGE[step.type] ?? step.type;
            return (
              <li key={step.id} className="flex gap-3">
                <div className="flex w-6 shrink-0 flex-col items-center">
                  <div
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full border-2 text-[9px] font-bold transition-all',
                      NODE_CLASS[state],
                    )}
                  >
                    {state === 'done' ? (
                      <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : state === 'running' ? (
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                    ) : state === 'review' ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {i < visible.length - 1 && (
                    <div
                      className={cn('my-1 w-px flex-1 transition-colors', CONNECTOR_CLASS[state])}
                      style={{ minHeight: 12 }}
                    />
                  )}
                </div>
                <div className={i < visible.length - 1 ? 'pb-4' : ''}>
                  <span
                    className={cn(
                      'text-[10px] font-bold tracking-wider',
                      BADGE_CLASS[state],
                    )}
                  >
                    <span className="uppercase">{badge}</span>
                    {durationLabel && (
                      <span className="font-medium normal-case tabular-nums text-text-tertiary">
                        {' '}
                        · {durationLabel}
                      </span>
                    )}
                  </span>
                  <p className={cn('text-sm leading-snug', LABEL_CLASS[state])}>
                    {step.label ?? step.id.replace(/_/g, ' ')}
                  </p>
                  {state === 'running' && (
                    <p className="mt-0.5 animate-pulse text-xs text-blue-500 dark:text-blue-400">
                      Running…
                    </p>
                  )}
                  {state === 'review' && (
                    <p className="mt-0.5 text-xs text-purple-600 dark:text-purple-400">
                      Waiting for review
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
