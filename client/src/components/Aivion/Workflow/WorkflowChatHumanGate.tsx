/* eslint-disable i18next/no-literal-string */
import type { StepParametersSchema, Workflow, WorkflowGatePrefill, WorkflowRun } from './types';
import { StepParameterGate, getGateReviewComponent, isSupportedChatGate } from './gates/registry';

interface Props {
  run: WorkflowRun;
  workflow: Workflow | null;
  runId: string;
  token: string | undefined;
  prefill?: WorkflowGatePrefill;
  prefillToken?: number;
  parameterPrefill?: Record<string, string>;
  parameterPrefillToken?: number;
  onResumed: () => void;
  onRunUpdated?: () => void | Promise<void>;
  onGateBusyChange?: (busy: boolean) => void;
}

export default function WorkflowChatHumanGate({
  run,
  workflow,
  runId,
  token,
  prefill,
  prefillToken,
  parameterPrefill,
  parameterPrefillToken,
  onResumed,
  onRunUpdated,
  onGateBusyChange,
}: Props) {
  if (!token || run.status !== 'awaiting_user') return null;
  if (!isSupportedChatGate(run.pending_input_schema)) {
    return (
      <div className="rounded-xl border border-border-light bg-surface-primary p-4 text-sm text-text-secondary">
        <p>This review step needs the full workflow UI.</p>
        <a
          href={`/workflow/${workflow?.id ?? run.workflow_id}/runs/${runId}`}
          className="mt-2 inline-block text-xs font-semibold text-amber-600 hover:underline"
        >
          Open full run view →
        </a>
      </div>
    );
  }

  const reviewProps = {
    run,
    workflow,
    runId,
    token,
    onResumed,
    onRunUpdated,
    onGateBusyChange,
    compact: true,
    prefill,
    prefillToken,
  };

  if (run.pending_input_schema?.type === 'step_parameters') {
    return (
      <div id="workflow-human-gate">
        <StepParameterGate
          run={run}
          schema={run.pending_input_schema as StepParametersSchema}
          runId={runId}
          token={token}
          onResumed={onResumed}
          prefill={parameterPrefill}
          prefillToken={parameterPrefillToken}
        />
      </div>
    );
  }

  const GateReview = getGateReviewComponent(run.pending_input_schema.type);
  if (!GateReview) return null;

  return (
    <div
      id="workflow-human-gate"
      className="max-h-[min(60vh,28rem)] overflow-y-auto rounded-xl border border-amber-200/80 bg-surface-primary dark:border-amber-800/40"
    >
      <GateReview {...reviewProps} />
    </div>
  );
}
