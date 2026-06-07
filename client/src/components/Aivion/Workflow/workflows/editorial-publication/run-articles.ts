import type { WorkflowRun } from '../../types';
import { completedStepMap } from '../../helpers';

const ARTICLE_STEP_IDS = [
  'package_publication',
  'draft_selected_stories',
] as const;

export type RunArticleItem = {
  recordId: string;
  title: string;
  section: string;
  summary: string;
  bodyExcerpt: string;
  sources: string[];
  revisionSummary?: string;
};

export type RunArticleBundle = {
  stepId: string;
  heading: string;
  decision?: string;
  publicationStatus?: string;
  dispatchStatus?: string;
  endpointUrl?: string;
  publishedCount?: number;
  items: RunArticleItem[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, maxLen = 400): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function extractSources(item: Record<string, unknown>): string[] {
  const raw = item.source_citations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      const record = asRecord(entry);
      if (!record) return '';
      return String(record.url ?? record.href ?? record.note ?? '').trim();
    })
    .filter(Boolean);
}

function normalizeArticleItem(item: Record<string, unknown>, index: number): RunArticleItem {
  const draft = asRecord(item.draft) ?? {};
  const body = cleanText(draft.body ?? item.body, 1200);
  const summary =
    cleanText(item.summary, 600) ||
    cleanText(draft.summary, 600) ||
    cleanText(body, 280);
  return {
    recordId: String(item.record_id ?? item.id ?? index),
    title: cleanText(item.title ?? draft.title, 200) || 'Untitled',
    section: cleanText(item.section ?? draft.section, 80) || 'General',
    summary,
    bodyExcerpt: body,
    sources: extractSources(item),
    revisionSummary: cleanText(item.revision_summary, 300) || undefined,
  };
}

function findBundleOutput(
  completed: Record<string, { output: unknown }>,
): { stepId: string; output: Record<string, unknown> } | null {
  for (const stepId of ARTICLE_STEP_IDS) {
    const output = asRecord(completed[stepId]?.output);
    if (output && Array.isArray(output.items) && output.items.length > 0) {
      return { stepId, output };
    }
  }

  for (const [stepId, step] of Object.entries(completed)) {
    const output = asRecord(step.output);
    if (output && Array.isArray(output.items) && output.items.length > 0) {
      return { stepId, output };
    }
  }

  return null;
}

export function extractRunArticleBundle(run: WorkflowRun): RunArticleBundle | null {
  const completed = completedStepMap(run);
  const match = findBundleOutput(completed);
  if (!match) return null;

  const { stepId, output } = match;
  const items = (output.items as unknown[])
    .map((item, index) => normalizeArticleItem(asRecord(item) ?? {}, index))
    .filter((item) => item.title !== 'Untitled' || item.summary || item.bodyExcerpt);

  if (items.length === 0) return null;

  const dispatch = asRecord(completed.dispatch_publication_bundle?.output);
  const heading = output.publication_status ? 'Publication bundle' : 'Article drafts';

  return {
    stepId,
    heading,
    decision: cleanText(output.decision, 80) || undefined,
    publicationStatus: cleanText(output.publication_status, 80) || undefined,
    dispatchStatus: cleanText(dispatch?.dispatch_status, 80) || undefined,
    endpointUrl: cleanText(dispatch?.endpoint_url, 200) || undefined,
    publishedCount:
      typeof dispatch?.published_count === 'number' ? dispatch.published_count : undefined,
    items,
  };
}

/** Compact text block injected into workflow chat so the agent can answer artifact questions. */
export function formatRunArticlesForChat(run: WorkflowRun): string | null {
  const bundle = extractRunArticleBundle(run);
  if (!bundle) return null;

  const lines = [
    `Run status: ${run.status}`,
    `Artifact step: ${bundle.stepId}`,
    bundle.publicationStatus ? `Publication status: ${bundle.publicationStatus}` : '',
    bundle.dispatchStatus ? `Dispatch status: ${bundle.dispatchStatus}` : '',
    bundle.endpointUrl ? `Dispatch endpoint: ${bundle.endpointUrl}` : '',
    bundle.publishedCount != null ? `Published count: ${bundle.publishedCount}` : '',
    '',
    `Articles (${bundle.items.length}):`,
  ].filter(Boolean);

  bundle.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.title}`,
      `   Section: ${item.section}`,
      item.summary ? `   Summary: ${item.summary}` : '',
      item.bodyExcerpt ? `   Body: ${item.bodyExcerpt}` : '',
      item.sources.length > 0 ? `   Sources: ${item.sources.join(', ')}` : '',
      item.revisionSummary ? `   Revision: ${item.revisionSummary}` : '',
    );
  });

  lines.push(
    '',
    'When the user asks about articles, drafts, titles, or publication output, answer from this artifact block. Quote titles and summaries directly.',
  );

  return lines.filter(Boolean).join('\n');
}
