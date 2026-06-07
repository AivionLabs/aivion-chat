import type { ComponentType } from 'react';
import type { WorkflowReviewProps } from '../types';
import { ArticleReview, RecordSelectionReview, isEditorialGateType } from '../workflows/editorial-publication';

export { default as StepParameterGate } from './step-parameters/StepParameterGate';

export const SUPPORTED_CHAT_GATE_TYPES = [
  'step_parameters',
  'record_selection',
  'article_review',
] as const;

export type SupportedChatGateType = (typeof SUPPORTED_CHAT_GATE_TYPES)[number];

export function isSupportedChatGate(
  schema: { type?: string } | null | undefined,
): schema is { type: SupportedChatGateType } {
  return SUPPORTED_CHAT_GATE_TYPES.includes(schema?.type as SupportedChatGateType);
}

const GATE_REVIEW_COMPONENTS: Record<string, ComponentType<WorkflowReviewProps>> = {
  record_selection: RecordSelectionReview,
  article_review: ArticleReview,
};

export function getGateReviewComponent(
  schemaType: string,
): ComponentType<WorkflowReviewProps> | null {
  return GATE_REVIEW_COMPONENTS[schemaType] ?? null;
}

export function isKnownGateType(type: string | undefined): boolean {
  return type === 'step_parameters' || isEditorialGateType(type);
}
