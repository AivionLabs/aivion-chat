import type { WorkflowAssistAction } from './assist-action-types';
import type { WorkflowRun } from './types';

const ARTICLE_REVIEW_CLIENT_KEYS = new Set(['decision', 'notes', 'revision_notes']);

export function validateWorkflowAction(
  action: WorkflowAssistAction,
  run: WorkflowRun | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!action?.kind) {
    return { ok: false, error: 'invalid_action' };
  }

  if (action.kind === 'navigate') {
    if (action.target !== 'human-gate' && !action.href) {
      return { ok: false, error: 'invalid_navigate_target' };
    }
    return { ok: true };
  }

  if (action.kind === 'artifact_action') {
    if (!run || run.status !== 'awaiting_user') {
      return { ok: false, error: 'run_not_awaiting_user' };
    }
    const schema = run.pending_input_schema;
    if (!schema || schema.type !== 'article_review') {
      return { ok: false, error: 'artifact_action_not_allowed_for_gate' };
    }
    if (!('source_step_id' in schema) || !schema.source_step_id) {
      return { ok: false, error: 'unsupported_run_version' };
    }
    if (action.action !== 'regenerate_item') {
      return { ok: false, error: 'unsupported_artifact_action' };
    }
    const stepId = action.stepId ?? (action as { step_id?: string }).step_id;
    if (stepId !== schema.source_step_id) {
      return { ok: false, error: 'artifact_step_mismatch' };
    }
    const payload = action.payload;
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'missing_artifact_payload' };
    }
    if (typeof payload.record_id !== 'string' || !payload.record_id.trim()) {
      return { ok: false, error: 'record_id_required' };
    }
    if (typeof payload.instructions !== 'string' || !payload.instructions.trim()) {
      return { ok: false, error: 'instructions_required' };
    }
    return { ok: true };
  }

  if (action.kind !== 'resume') {
    return { ok: false, error: 'unsupported_action_kind' };
  }

  if (!run || run.status !== 'awaiting_user') {
    return { ok: false, error: 'run_not_awaiting_user' };
  }

  const schema = run.pending_input_schema;
  if (!schema || schema.type !== 'article_review') {
    return { ok: false, error: 'resume_not_allowed_for_gate' };
  }

  const payload = action.payload;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'missing_resume_payload' };
  }

  for (const key of Object.keys(payload)) {
    if (!ARTICLE_REVIEW_CLIENT_KEYS.has(key)) {
      return { ok: false, error: `disallowed_payload_key:${key}` };
    }
  }

  const decision = payload.decision;
  if (typeof decision !== 'string' || !decision.trim()) {
    return { ok: false, error: 'decision_required' };
  }

  const rawOptions =
    'decision_options' in schema && Array.isArray(schema.decision_options)
      ? schema.decision_options
      : ['approve', 'reject'];
  const options = rawOptions.filter((option) => option && option !== 'revise');
  if (!options.includes(decision)) {
    return { ok: false, error: 'invalid_decision' };
  }

  return { ok: true };
}
