/* eslint-disable i18next/no-literal-string */
import { cn } from '~/utils';
import {
  STEP_CHIP_CLASS,
  completedStepMap,
  getWorkflowStepState,
  type WorkflowStepVisualState,
} from './helpers';
import type { WorkflowRun, WorkflowStep } from './types';

interface Props {
  run?: WorkflowRun | null;
  steps: WorkflowStep[];
  /** When no run is active, show neutral preview chips. */
  preview?: boolean;
  limit?: number;
  className?: string;
}

function stepLabel(step: WorkflowStep): string {
  if (typeof step.label === 'string' && step.label.trim()) return step.label.trim();
  return step.id.replace(/_/g, ' ');
}

export default function WorkflowStepChips({
  run,
  steps,
  preview = false,
  limit = 12,
  className,
}: Props) {
  const visible = steps.filter((s) => s.label || s.id).slice(0, limit);
  if (visible.length === 0) return null;

  const done = run ? completedStepMap(run) : {};

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {visible.map((step) => {
        const label = stepLabel(step);
        let state: WorkflowStepVisualState = 'pending';
        if (run) {
          state = getWorkflowStepState(run, step.id, done);
        } else if (preview) {
          state = 'pending';
        }
        return (
          <span
            key={step.id}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              preview && !run
                ? 'border-amber-200 bg-white text-amber-800 shadow-sm dark:border-amber-800/50 dark:bg-surface-primary dark:text-amber-300'
                : STEP_CHIP_CLASS[state],
              state === 'running' && 'animate-pulse',
            )}
            title={state}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
