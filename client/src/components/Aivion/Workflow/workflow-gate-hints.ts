import type { WorkflowGatePrefill } from './types';
import { parseEditorialGateHints, isEditorialGateType } from './workflows/editorial-publication';
import { isSupportedChatGate } from './gates/registry';

export { isSupportedChatGate };

/** Best-effort parse of natural-language gate decisions from chat (hints only — user still clicks Submit). */
export function parseGateHintsFromChat(
  text: string,
  schemaType: 'record_selection' | 'article_review' | null,
): WorkflowGatePrefill | null {
  if (!schemaType || !isEditorialGateType(schemaType)) return null;
  return parseEditorialGateHints(text, schemaType);
}
