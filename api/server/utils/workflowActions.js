/**
 * Server-driven assist action chips — built deterministically from run state,
 * never parsed from LLM output.
 */

const { parseRegenerateIntent } = require('./workflowRegenerateIntent');

const ARTICLE_REVIEW_CLIENT_KEYS = new Set(['decision', 'notes', 'revision_notes']);
const ARTIFACT_ACTION_PAYLOAD_KEYS = new Set(['record_id', 'instructions']);

function formatDecisionLabel(value) {
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function navigateToGateAction(label = 'Open review card') {
  return {
    id: 'open_review',
    label,
    kind: 'navigate',
    target: 'human-gate',
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} runSnapshot
 * @param {{ userMessage?: string }} [options]
 * @returns {Array<Record<string, unknown>>}
 */
function buildWorkflowActions(runSnapshot, options = {}) {
  if (!runSnapshot || runSnapshot.status !== 'awaiting_user') return [];

  const schema = runSnapshot.pending_input_schema;
  if (!schema || typeof schema !== 'object' || !schema.type) return [];

  const gateType = schema.type;
  const actions = [navigateToGateAction()];

  if (gateType === 'article_review') {
    // Approve / reject / handoff live on the review card — chat only navigates + regenerates.
    const regenerate = parseRegenerateIntent(options.userMessage, schema);
    if (regenerate) {
      actions.push({
        id: 'regenerate_item',
        label: 'Regenerate article',
        kind: 'artifact_action',
        step_id: schema.source_step_id,
        action: 'regenerate_item',
        payload: {
          record_id: regenerate.record_id,
          instructions: regenerate.instructions,
        },
      });
    }
  }

  // record_selection + step_parameters: navigate-only in Phase B
  return actions;
}

/**
 * Client/server allowlist check before executing a chip action.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateWorkflowAction(action, runSnapshot) {
  if (!action || typeof action !== 'object') {
    return { ok: false, error: 'invalid_action' };
  }

  const { kind, payload, target, step_id: stepId, action: actionName } = action;
  if (kind === 'navigate') {
    if (target !== 'human-gate') {
      return { ok: false, error: 'invalid_navigate_target' };
    }
    return { ok: true };
  }

  if (kind === 'artifact_action') {
    if (!runSnapshot || runSnapshot.status !== 'awaiting_user') {
      return { ok: false, error: 'run_not_awaiting_user' };
    }
    const schema = runSnapshot.pending_input_schema;
    if (!schema || schema.type !== 'article_review') {
      return { ok: false, error: 'artifact_action_not_allowed_for_gate' };
    }
    if (!schema.source_step_id) {
      return { ok: false, error: 'unsupported_run_version' };
    }
    if (actionName !== 'regenerate_item') {
      return { ok: false, error: 'unsupported_artifact_action' };
    }
    if (stepId !== schema.source_step_id) {
      return { ok: false, error: 'artifact_step_mismatch' };
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'missing_artifact_payload' };
    }
    for (const key of Object.keys(payload)) {
      if (!ARTIFACT_ACTION_PAYLOAD_KEYS.has(key)) {
        return { ok: false, error: `disallowed_payload_key:${key}` };
      }
    }
    if (typeof payload.record_id !== 'string' || !payload.record_id.trim()) {
      return { ok: false, error: 'record_id_required' };
    }
    if (typeof payload.instructions !== 'string' || !payload.instructions.trim()) {
      return { ok: false, error: 'instructions_required' };
    }
    return { ok: true };
  }

  if (kind !== 'resume') {
    return { ok: false, error: 'unsupported_action_kind' };
  }

  if (!runSnapshot || runSnapshot.status !== 'awaiting_user') {
    return { ok: false, error: 'run_not_awaiting_user' };
  }

  const schema = runSnapshot.pending_input_schema;
  if (!schema || schema.type !== 'article_review') {
    return { ok: false, error: 'resume_not_allowed_for_gate' };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'missing_resume_payload' };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!ARTICLE_REVIEW_CLIENT_KEYS.has(key)) {
      return { ok: false, error: `disallowed_payload_key:${key}` };
    }
  }

  const decision = payload.decision;
  if (typeof decision !== 'string' || !decision.trim()) {
    return { ok: false, error: 'decision_required' };
  }

  const rawOptions = Array.isArray(schema.decision_options)
    ? schema.decision_options
    : ['approve', 'reject'];
  const options = rawOptions.filter((option) => option && option !== 'revise');
  if (!options.includes(decision)) {
    return { ok: false, error: 'invalid_decision' };
  }

  for (const key of ['notes', 'revision_notes']) {
    if (payload[key] != null && typeof payload[key] !== 'string') {
      return { ok: false, error: `invalid_${key}` };
    }
  }

  return { ok: true };
}

module.exports = {
  buildWorkflowActions,
  validateWorkflowAction,
  formatDecisionLabel,
  ARTICLE_REVIEW_CLIENT_KEYS,
  ARTIFACT_ACTION_PAYLOAD_KEYS,
};
