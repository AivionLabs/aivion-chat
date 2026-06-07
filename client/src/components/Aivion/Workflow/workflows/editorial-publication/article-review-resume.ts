/** Resume payload for article_review gates — used by the review card submit action. */

export type ArticleItemDecision = 'approve' | 'cancel';

export function getArticleRecordId(item: Record<string, unknown>, index: number): string {
  const raw = item.record_id ?? item.cluster_id ?? item.id ?? index;
  return String(raw).trim();
}

export function buildArticleReviewResumePayload(opts: {
  decision: string;
  notes?: string;
  revisionNotes?: string;
}): { decision: string; notes: string; revision_notes: string } {
  const notes = (opts.notes ?? '').trim();
  const revisionNotes = (opts.revisionNotes ?? notes).trim();
  return {
    decision: opts.decision,
    notes,
    revision_notes: revisionNotes,
  };
}

export function buildPerItemArticleReviewResumePayload(opts: {
  items: Record<string, unknown>[];
  itemDecisions: Record<string, ArticleItemDecision>;
}): {
  decision: string;
  notes: string;
  revision_notes: string;
  item_decisions: Array<{ record_id: string; decision: ArticleItemDecision }>;
} {
  const item_decisions = opts.items.map((item, index) => {
    const recordId = getArticleRecordId(item, index);
    const decision = opts.itemDecisions[recordId];
    if (!decision) {
      throw new Error(`Missing decision for ${recordId}`);
    }
    return { record_id: recordId, decision };
  });

  return {
    decision: 'approve',
    notes: '',
    revision_notes: '',
    item_decisions,
  };
}

export function allItemsDecided(
  items: Record<string, unknown>[],
  itemDecisions: Record<string, ArticleItemDecision | undefined>,
): boolean {
  if (items.length === 0) return false;
  return items.every((item, index) => {
    const recordId = getArticleRecordId(item, index);
    const decision = itemDecisions[recordId];
    return decision === 'approve' || decision === 'cancel';
  });
}

export function countItemDecisions(
  items: Record<string, unknown>[],
  itemDecisions: Record<string, ArticleItemDecision | undefined>,
): { decided: number; approved: number; cancelled: number } {
  let decided = 0;
  let approved = 0;
  let cancelled = 0;
  for (const [index, item] of items.entries()) {
    const recordId = getArticleRecordId(item, index);
    const decision = itemDecisions[recordId];
    if (decision === 'approve') {
      decided += 1;
      approved += 1;
    } else if (decision === 'cancel') {
      decided += 1;
      cancelled += 1;
    }
  }
  return { decided, approved, cancelled };
}
