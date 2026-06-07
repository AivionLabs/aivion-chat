const { parseRegenerateIntent } = require('./workflowRegenerateIntent');
const { buildWorkflowActions } = require('./workflowActions');

describe('workflowRegenerateIntent', () => {
  const schema = {
    type: 'article_review',
    source_step_id: 'draft_selected_stories',
    title_field: 'title',
    items: [
      { record_id: 'cluster-001', title: 'Boston Children AI Safety' },
      { record_id: 'cluster-002', title: 'OpenAI Government Deal' },
    ],
  };

  test('matches ordinal reference', () => {
    const result = parseRegenerateIntent(
      'Please revise the second article to emphasize regulatory context',
      schema,
    );
    expect(result).toEqual({
      record_id: 'cluster-002',
      instructions: 'Please revise the second article to emphasize regulatory context',
    });
  });

  test('matches title substring', () => {
    const result = parseRegenerateIntent(
      'Update the Boston Children AI Safety draft with a stronger lead',
      schema,
    );
    expect(result?.record_id).toBe('cluster-001');
  });

  test('returns null without source_step_id', () => {
    expect(
      parseRegenerateIntent('revise the second article', {
        type: 'article_review',
        items: schema.items,
      }),
    ).toBeNull();
  });

  test('returns null without edit intent', () => {
    expect(parseRegenerateIntent('Which article mentions OpenAI?', schema)).toBeNull();
  });
});

describe('buildWorkflowActions regenerate chip', () => {
  test('adds regenerate chip when edit intent is detected', () => {
    const actions = buildWorkflowActions(
      {
        status: 'awaiting_user',
        pending_input_schema: {
          type: 'article_review',
          source_step_id: 'draft_selected_stories',
          decision_options: ['approve', 'reject'],
          items: [{ record_id: 'cluster-001', title: 'Only Story' }],
        },
      },
      { userMessage: 'Regenerate this article with a tighter opening.' },
    );

    const regenerate = actions.find((action) => action.id === 'regenerate_item');
    expect(regenerate).toMatchObject({
      kind: 'artifact_action',
      step_id: 'draft_selected_stories',
      action: 'regenerate_item',
      payload: {
        record_id: 'cluster-001',
        instructions: 'Regenerate this article with a tighter opening.',
      },
    });
  });
});
