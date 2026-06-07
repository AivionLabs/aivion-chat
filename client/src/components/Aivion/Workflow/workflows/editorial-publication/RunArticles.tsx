/* eslint-disable i18next/no-literal-string */
import { extractRunArticleBundle } from './run-articles';
import type { WorkflowRun } from '../../types';

interface Props {
  run: WorkflowRun;
  compact?: boolean;
}

export default function RunArticles({ run, compact }: Props) {
  const bundle = extractRunArticleBundle(run);
  if (!bundle) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {bundle.heading}
        </p>
        <div className="flex flex-wrap gap-2 text-[11px] text-text-secondary">
          {bundle.decision && <span>Decision: {bundle.decision}</span>}
          {bundle.publicationStatus && <span>Status: {bundle.publicationStatus}</span>}
          {bundle.dispatchStatus && <span>Dispatch: {bundle.dispatchStatus}</span>}
        </div>
      </div>

      {bundle.endpointUrl && (
        <p className="text-xs text-text-secondary">
          Endpoint: <span className="font-mono text-text-primary">{bundle.endpointUrl}</span>
        </p>
      )}

      {bundle.items.map((item, index) => (
        <div
          key={item.recordId}
          className="rounded-xl border border-border-light bg-surface-primary p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className={compact ? 'text-sm font-semibold text-text-primary' : 'font-semibold text-text-primary'}>
              {item.title}
            </p>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              {item.section}
            </span>
          </div>

          {item.summary && (
            <p className="mt-2 text-sm text-text-secondary">{item.summary}</p>
          )}

          {!compact && item.bodyExcerpt && item.bodyExcerpt !== item.summary && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{item.bodyExcerpt}</p>
          )}

          {item.sources.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                Sources
              </p>
              {item.sources.map((url) => (
                <a
                  key={`${item.recordId}-${url}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-amber-600 hover:underline"
                >
                  {url}
                </a>
              ))}
            </div>
          )}

          {item.revisionSummary && (
            <p className="mt-2 text-sm text-text-secondary">Revision: {item.revisionSummary}</p>
          )}

          {index === 0 && bundle.publishedCount != null && (
            <p className="mt-2 text-xs text-text-secondary">
              {bundle.publishedCount} article{bundle.publishedCount === 1 ? '' : 's'} dispatched
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
