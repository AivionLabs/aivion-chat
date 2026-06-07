/* eslint-disable i18next/no-literal-string */
import { cn } from '~/utils';
import { STATUS_BADGE, STATUS_LABEL } from './constants';
import { workflowStepProgress } from './helpers';
import WorkflowStepChips from './WorkflowStepChips';
import type { WorkflowRun, WorkflowStep } from './types';

interface Props {
  run: WorkflowRun;
  steps: WorkflowStep[];
  compact?: boolean;
}

export default function WorkflowChatRunProgress({ run, steps, compact }: Props) {
  const statusClass = STATUS_BADGE[run.status] ?? STATUS_BADGE.running;
  const statusLabel = STATUS_LABEL[run.status] ?? run.status;
  const { doneCount, total, currentLabel } = workflowStepProgress(run, steps);
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            statusClass,
          )}
        >
          {statusLabel}
        </span>
        {total > 0 && (
          <span className="text-xs text-text-secondary">
            {doneCount}/{total} steps
            {run.status === 'running' || run.status === 'scheduled' ? ` · ${progressPct}%` : ''}
          </span>
        )}
        {currentLabel && run.status === 'running' && (
          <span className="text-xs text-text-secondary">
            Running: <span className="font-medium text-text-primary">{currentLabel}</span>
          </span>
        )}
        {run.status === 'awaiting_user' && (
          <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
            Waiting for your review
            {currentLabel ? `: ${currentLabel}` : ''}
          </span>
        )}
        {run.status === 'failed' && currentLabel && (
          <span className="text-xs font-medium text-red-700 dark:text-red-300">
            Failed at: {currentLabel}
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              run.status === 'failed'
                ? 'bg-red-500'
                : run.status === 'completed'
                  ? 'bg-green-500'
                  : run.status === 'awaiting_user'
                    ? 'bg-purple-500'
                    : 'bg-amber-500',
            )}
            style={{ width: `${Math.max(progressPct, run.status === 'running' ? 8 : 0)}%` }}
          />
        </div>
      )}

      <WorkflowStepChips run={run} steps={steps} limit={compact ? 8 : 12} />
    </div>
  );
}
