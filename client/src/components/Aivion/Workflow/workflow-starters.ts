import type { WorkflowRun, WorkflowSpec } from './types';
import { isInteractiveWorkflowSpec } from './workflow-spec-utils';
import { getEditorialChatStarters } from './workflows/editorial-publication';

type WorkflowLike = {
  slug?: string;
  spec?: WorkflowSpec;
} | null;

const RUN_DEFAULT = [
  'What is the current status?',
  'What should I do next?',
  'Summarise the results',
];

const WORKFLOW_DEFAULT = ['Start a run', 'Show pending reviews', 'What inputs do I need?'];

const INTERACTIVE_WORKFLOW_DEFAULT = [
  'Start workflow',
  'Show pending reviews',
  'What happens on each step?',
];

const STEP_PARAMETERS = [
  'What settings should I use?',
  'What should I do next?',
  'Summarise this step',
];

export function getWorkflowChatStarters(opts: {
  workflow?: WorkflowLike;
  runId?: string;
  run?: WorkflowRun | null;
  hasLastRunPreset?: boolean;
}): string[] {
  const { workflow, runId, run, hasLastRunPreset } = opts;

  const editorial = getEditorialChatStarters({ workflow, runId, run });
  if (editorial) return editorial;

  if (runId && run?.status === 'awaiting_user') {
    const gateType = run.pending_input_schema?.type;
    if (gateType === 'step_parameters') return STEP_PARAMETERS;
    return ['What review is needed?', 'What should I do next?'];
  }

  if (runId) {
    return RUN_DEFAULT;
  }

  if (workflow) {
    if (isInteractiveWorkflowSpec(workflow.spec)) {
      return INTERACTIVE_WORKFLOW_DEFAULT;
    }
    const hasInputs = (workflow.spec?.inputs?.length ?? 0) > 0;
    if (hasInputs) {
      if (hasLastRunPreset) {
        return ['Run with last settings', 'Start a run', 'Show pending reviews'];
      }
      return WORKFLOW_DEFAULT;
    }
    return ['Start a run', 'Show pending reviews'];
  }

  return RUN_DEFAULT;
}
