import type { WorkflowAssistAction } from './assist-action-types';

export type WorkflowAssistMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type WorkflowAssistResponse = {
  reply: string;
  actions: WorkflowAssistAction[];
};

const EMPTY_REPLY_FALLBACK =
  'I could not generate a response. Please try again or use the review card below.';

function parseAssistActions(raw: unknown): WorkflowAssistAction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is WorkflowAssistAction & { step_id?: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as WorkflowAssistAction).id === 'string' &&
        typeof (item as WorkflowAssistAction).label === 'string' &&
        typeof (item as WorkflowAssistAction).kind === 'string',
    )
    .map((item) => ({
      ...item,
      stepId: item.stepId ?? item.step_id,
    }));
}

export async function postWorkflowAssist(params: {
  token: string;
  workflowId: string;
  runId: string;
  messages: WorkflowAssistMessage[];
}): Promise<WorkflowAssistResponse> {
  const res = await fetch('/api/aivion/workflow/assist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.token}`,
    },
    body: JSON.stringify({
      workflow_id: params.workflowId,
      run_id: params.runId,
      messages: params.messages,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    reply?: string;
    actions?: unknown;
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    const detail = data.message ?? data.error ?? `HTTP ${res.status}`;
    if (data.error === 'chat_unavailable') {
      throw new Error('Workflow copilot is only available while a run is waiting for your review.');
    }
    throw new Error(detail);
  }

  const reply = data.reply?.trim() || EMPTY_REPLY_FALLBACK;
  return { reply, actions: parseAssistActions(data.actions) };
}
