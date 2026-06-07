import type { ComponentType } from 'react';
import type { WorkflowReviewProps } from '../types';
import { ArticleReview, RecordSelectionReview } from './editorial-publication';
import { CvScreeningReview, CV_SCREENING_SLUGS } from './cv-screening';
import { SocialMediaPostReview, SOCIAL_MEDIA_POST_SLUG } from './social-media-post';

/** Normalize platform workflow slug (strip version suffix e.g. editorial-publication-2). */
export function normalizeWorkflowSlug(slug: string | undefined | null): string {
  return slug?.replace(/-\d+$/, '') ?? '';
}

/** Slug-keyed full-run review surfaces (non-gate schemas). */
export const WORKFLOW_REVIEW_BY_SLUG: Record<string, ComponentType<WorkflowReviewProps>> = {
  [CV_SCREENING_SLUGS[0]]: CvScreeningReview,
  [CV_SCREENING_SLUGS[1]]: CvScreeningReview,
  [SOCIAL_MEDIA_POST_SLUG]: SocialMediaPostReview,
};

/** Gate-schema review surfaces (may be shared across workflows later). */
export const GATE_REVIEW_BY_TYPE: Record<string, ComponentType<WorkflowReviewProps>> = {
  record_selection: RecordSelectionReview,
  article_review: ArticleReview,
};

export function resolveWorkflowReviewComponent(opts: {
  schemaType?: string;
  workflowSlug?: string;
}): ComponentType<WorkflowReviewProps> | undefined {
  const { schemaType, workflowSlug } = opts;

  if (schemaType && GATE_REVIEW_BY_TYPE[schemaType]) {
    return GATE_REVIEW_BY_TYPE[schemaType];
  }

  if (!workflowSlug) return undefined;
  const normalized = normalizeWorkflowSlug(workflowSlug);
  return WORKFLOW_REVIEW_BY_SLUG[workflowSlug] ?? WORKFLOW_REVIEW_BY_SLUG[normalized];
}
