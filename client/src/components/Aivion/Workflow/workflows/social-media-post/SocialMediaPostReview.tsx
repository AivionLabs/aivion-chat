import { useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkflowReviewProps } from '../../types';
import { completedStepMap } from '../../helpers';

interface SocialMediaPostSchema {
  type: 'social_media_post';
  post_text: string;
  source_url: string;
  active_platforms: string[];
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  twitter: 'X / Twitter',
};

const PLATFORM_ICONS: Record<string, ReactNode> = {
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  ),
  twitter: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
};

const _TW_MAX = 280;

export function SocialMediaPostReview({ run, runId, token, onResumed }: WorkflowReviewProps) {
  const schema = run.pending_input_schema?.type === 'social_media_post'
    ? (run.pending_input_schema as unknown as SocialMediaPostSchema)
    : null;

  const [postText, setPostText] = useState(schema?.post_text ?? '');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    () => new Set(schema?.active_platforms ?? []),
  );
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const activePlatforms = schema?.active_platforms ?? [];
  const sourceUrl = schema?.source_url ?? '';
  const charCount = postText.length;
  const showTwitterWarning = selectedPlatforms.has('twitter') && charCount > _TW_MAX;

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function submit(decision: 'publish' | 'reject') {
    setResuming(true);
    setResumeError(null);
    try {
      const body = decision === 'publish'
        ? { decision, post_text: postText, selected_platforms: Array.from(selectedPlatforms).join(',') }
        : { decision };
      const res = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input: body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `${res.status}`);
      }
      onResumed();
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Failed to submit.');
    } finally {
      setResuming(false);
    }
  }

  if (run.status === 'awaiting_user' && schema) {
    const canPublish = selectedPlatforms.size > 0 && postText.trim().length > 0;
    return (
      <div className="space-y-4 p-5 lg:p-7">
        {sourceUrl && (
          <div className="flex items-center gap-3 rounded-xl border border-border-light bg-surface-secondary px-4 py-3">
            <svg className="h-4 w-4 shrink-0 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
            </svg>
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
               className="block truncate text-sm text-amber-600 hover:underline dark:text-amber-400">
              {sourceUrl}
            </a>
          </div>
        )}

        <div className="rounded-xl border border-border-light bg-surface-primary p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Post Text</p>
            <span className={`tabular-nums text-xs ${showTwitterWarning ? 'text-red-500 font-semibold' : 'text-text-tertiary'}`}>
              {charCount.toLocaleString()} chars
              {selectedPlatforms.has('twitter') && ` / ${_TW_MAX} Twitter`}
            </span>
          </div>
          <textarea
            rows={8}
            className="w-full resize-y rounded-lg border border-border-light bg-surface-secondary px-3 py-3 text-sm leading-relaxed text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            value={postText}
            onChange={(e) => setPostText(e.target.value)}
            placeholder="Edit the post text before publishing…"
          />
          {showTwitterWarning && (
            <p className="text-xs text-red-500">
              Post exceeds Twitter's 280-character limit. It will be automatically truncated when posted to X.
            </p>
          )}
        </div>

        {activePlatforms.length > 0 && (
          <div className="rounded-xl border border-border-light bg-surface-primary p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Publish to</p>
            <div className="flex flex-wrap gap-2">
              {activePlatforms.map((p) => {
                const selected = selectedPlatforms.has(p);
                const Icon = PLATFORM_ICONS[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                      selected
                        ? 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-400 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-300'
                        : 'border-border-light bg-surface-secondary text-text-secondary hover:border-border-medium hover:text-text-primary'
                    }`}
                  >
                    {Icon}
                    {PLATFORM_LABELS[p] ?? p}
                    {selected && (
                      <svg className="h-3.5 w-3.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
            {selectedPlatforms.size === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Select at least one platform to publish.</p>
            )}
          </div>
        )}

        {resumeError && <p className="text-xs text-red-500">{resumeError}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={resuming || !canPublish}
            onClick={() => submit('publish')}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resuming ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Publishing…
              </>
            ) : (
              <>
                Publish
                {selectedPlatforms.size > 0 && ` to ${Array.from(selectedPlatforms).map((p) => PLATFORM_LABELS[p] ?? p).join(' & ')}`}
              </>
            )}
          </button>
          <button
            type="button"
            disabled={resuming}
            onClick={() => submit('reject')}
            className="rounded-xl border border-border-light bg-surface-secondary px-5 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-red-700/50 dark:hover:bg-red-900/10 dark:hover:text-red-400"
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  if (run.status === 'completed') {
    const done = completedStepMap(run);
    const fbOut = (done['publish_facebook']?.output ?? {}) as Record<string, unknown>;
    const twOut = (done['publish_twitter']?.output ?? {}) as Record<string, unknown>;
    const fbPublished = !fbOut['skipped'] && fbOut['post_id'];
    const twPublished = !twOut['skipped'] && twOut['tweet_id'];

    const result = (run.outputs as Record<string, unknown>)?.['result'] as Record<string, unknown> | undefined;
    const rejected = !fbPublished && !twPublished && result?.['decision'] === 'reject';

    if (!fbPublished && !twPublished && !rejected) return null;

    return (
      <div className="p-5 lg:p-7 space-y-4">
        {rejected ? (
          <div className="rounded-xl border border-border-light bg-surface-secondary p-4">
            <p className="text-sm text-text-secondary">Post was rejected and not published.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Published</p>
            {fbPublished && (
              <a
                href={String(fbOut['permalink'] ?? '')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border-light bg-surface-primary px-4 py-3 transition-colors hover:bg-surface-secondary"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-white">
                  {PLATFORM_ICONS['facebook']}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">Facebook</p>
                  <p className="truncate text-xs text-amber-600 dark:text-amber-400">
                    {String(fbOut['permalink'] ?? '—')}
                  </p>
                </div>
                <svg className="h-4 w-4 shrink-0 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            )}
            {twPublished && (
              <a
                href={String(twOut['permalink'] ?? '')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-xl border border-border-light bg-surface-primary px-4 py-3 transition-colors hover:bg-surface-secondary"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white">
                  {PLATFORM_ICONS['twitter']}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">X / Twitter</p>
                  <p className="truncate text-xs text-amber-600 dark:text-amber-400">
                    {String(twOut['permalink'] ?? '—')}
                  </p>
                </div>
                <svg className="h-4 w-4 shrink-0 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
