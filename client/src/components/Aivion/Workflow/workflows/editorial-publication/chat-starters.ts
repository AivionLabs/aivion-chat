import type { WorkflowRun, WorkflowSpec } from '../../types';

type WorkflowLike = {
  slug?: string;
  spec?: WorkflowSpec;
} | null;

const RECORD_SELECTION = [
  'Which clusters should I pick?',
  'What are the highest scored stories?',
  'What should I do next?',
];

const ARTICLE_REVIEW = [
  'Summarise the drafts',
  'What should I revise?',
  'What should I do next?',
];

const RUN_COMPLETED = [
  'What articles were produced?',
  'Summarise the publication bundle',
  'Where were the drafts sent?',
];

/** Editorial-specific chat starters; returns null when this package does not apply. */
export function getEditorialChatStarters(opts: {
  workflow?: WorkflowLike;
  runId?: string;
  run?: WorkflowRun | null;
}): string[] | null {
  const { workflow, runId, run } = opts;
  const slug = workflow?.slug?.replace(/-\d+$/, '') ?? '';

  if (runId && run?.status === 'awaiting_user') {
    const gateType = run.pending_input_schema?.type;
    if (gateType === 'record_selection') return RECORD_SELECTION;
    if (gateType === 'article_review') return ARTICLE_REVIEW;
  }

  if (runId && run?.status === 'completed' && slug === 'editorial-publication') {
    return RUN_COMPLETED;
  }

  return null;
}
