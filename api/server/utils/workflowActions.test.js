const { buildWorkflowActions, validateWorkflowAction } = require('./workflowActions');
const { parseRegenerateIntent } = require('./workflowRegenerateIntent');

describe('workflowActions', () => {
  const articleRun = {
    status: 'awaiting_user',
    pending_input_schema: {
      type: 'article_review',
      decision_options: ['approve', 'reject'],
      items: [{ title: 'Draft A' }],
    },
  };

  test('buildWorkflowActions is navigate-only for article_review without edit intent', () => {
    const actions = buildWorkflowActions(articleRun);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'navigate', target: 'human-gate', label: 'Open review card' });
    expect(actions.some((action) => action.kind === 'resume')).toBe(false);
  });

  test('buildWorkflowActions is navigate-only for record_selection', () => {
    const actions = buildWorkflowActions({
      status: 'awaiting_user',
      pending_input_schema: { type: 'record_selection', items: [] },
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('navigate');
  });

  test('validateWorkflowAction accepts article_review resume payload', () => {
    const result = validateWorkflowAction(
      { kind: 'resume', payload: { decision: 'approve', notes: 'LGTM' } },
      articleRun,
    );
    expect(result).toEqual({ ok: true });
  });

  test('validateWorkflowAction rejects unknown payload keys', () => {
    const result = validateWorkflowAction(
      { kind: 'resume', payload: { decision: 'approve', source_storage_key: 'x' } },
      articleRun,
    );
    expect(result.ok).toBe(false);
  });

  test('validateWorkflowAction rejects resume on record_selection', () => {
    const result = validateWorkflowAction(
      { kind: 'resume', payload: { decision: 'approve' } },
      {
        status: 'awaiting_user',
        pending_input_schema: { type: 'record_selection', items: [] },
      },
    );
    expect(result).toEqual({ ok: false, error: 'resume_not_allowed_for_gate' });
  });

  test('validateWorkflowAction accepts regenerate_item artifact action', () => {
    const run = {
      status: 'awaiting_user',
      pending_input_schema: {
        type: 'article_review',
        source_step_id: 'draft_selected_stories',
        items: [],
      },
    };
    const result = validateWorkflowAction(
      {
        kind: 'artifact_action',
        step_id: 'draft_selected_stories',
        action: 'regenerate_item',
        payload: {
          record_id: 'cluster-001',
          instructions: 'Tighten the opening paragraph.',
        },
      },
      run,
    );
    expect(result).toEqual({ ok: true });
  });

  test('parseRegenerateIntent matches explicit record id', () => {
    const result = parseRegenerateIntent('Revise cluster-002 with more regulatory detail', {
      type: 'article_review',
      source_step_id: 'draft_selected_stories',
      items: [
        { record_id: 'cluster-001', title: 'One' },
        { record_id: 'cluster-002', title: 'Two' },
      ],
    });
    expect(result?.record_id).toBe('cluster-002');
  });
});
