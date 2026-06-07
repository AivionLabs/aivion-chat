export type WorkflowAssistActionKind = 'navigate' | 'resume' | 'artifact_action';

export type WorkflowAssistAction = {
  id: string;
  label: string;
  kind: WorkflowAssistActionKind;
  target?: 'human-gate';
  href?: string;
  payload?: Record<string, unknown>;
  stepId?: string;
  action?: string;
};
