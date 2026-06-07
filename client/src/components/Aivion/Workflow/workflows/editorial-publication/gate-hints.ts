import type { WorkflowGatePrefill } from '../../types';

/** Editorial gate chat prefill hints (story selection + draft review). */
export function parseEditorialGateHints(
  text: string,
  schemaType: 'record_selection' | 'article_review',
): WorkflowGatePrefill | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  if (schemaType === 'article_review') {
    const hints: WorkflowGatePrefill = {};
    if (/\bapprove\b/.test(normalized)) hints.decision = 'approve';
    else if (/\breject\b|\bdeny\b/.test(normalized)) hints.decision = 'reject';
    else if (/\brevise\b|\brevision\b/.test(normalized)) hints.decision = 'revise';

    const sectionMatch = normalized.match(/\b(?:for|to)\s+(lead|news|research|products|policy|opinion)\b/i);
    if (sectionMatch?.[1]) hints.section = sectionMatch[1];

    const notesMatch = text.match(/notes?:\s*(.+)$/i);
    if (notesMatch?.[1]) hints.reviewNotes = notesMatch[1].trim();

    return Object.keys(hints).length > 0 ? hints : null;
  }

  const hints: WorkflowGatePrefill = {};
  const indexMatches = [
    ...normalized.matchAll(/\b(?:cluster|story|item|record|#)\s*(\d+)\b/g),
    ...normalized.matchAll(/\b(\d+)\s*(?:,|and)\s*(\d+)/g),
  ];
  const indices = new Set<number>();
  for (const match of indexMatches) {
    for (let i = 1; i < match.length; i += 1) {
      const n = Number(match[i]);
      if (Number.isInteger(n) && n > 0) indices.add(n);
    }
  }
  const listMatch = normalized.match(/\b(?:pick|select|choose)\s+([\d,\sand]+)/);
  if (listMatch?.[1]) {
    for (const part of listMatch[1].split(/[,\s]+/)) {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0) indices.add(n);
    }
  }
  if (indices.size > 0) hints.selectionIndices = [...indices].sort((a, b) => a - b);

  const sectionMatch = normalized.match(/\b(?:for|to|in)\s+(lead|news|research|products|policy|opinion)\b/i);
  if (sectionMatch?.[1]) {
    hints.section = sectionMatch[1].charAt(0).toUpperCase() + sectionMatch[1].slice(1);
  }

  const notesMatch = text.match(/notes?:\s*(.+)$/i);
  if (notesMatch?.[1]) hints.editorNotes = notesMatch[1].trim();

  return Object.keys(hints).length > 0 ? hints : null;
}

export const EDITORIAL_GATE_TYPES = ['record_selection', 'article_review'] as const;

export function isEditorialGateType(
  type: string | undefined,
): type is (typeof EDITORIAL_GATE_TYPES)[number] {
  return type === 'record_selection' || type === 'article_review';
}
