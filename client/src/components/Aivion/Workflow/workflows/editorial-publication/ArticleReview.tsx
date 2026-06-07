import { useEffect, useMemo, useState } from 'react';
import type { ArticleReviewSchema, WorkflowReviewProps } from '../../types';
import RunArticles from './RunArticles';
import {
  allItemsDecided,
  buildArticleReviewResumePayload,
  buildPerItemArticleReviewResumePayload,
  countItemDecisions,
  getArticleRecordId,
  type ArticleItemDecision,
} from './article-review-resume';

type ReviewDecision = string;
type RegenerateTarget = { scope: 'one'; recordId: string } | { scope: 'all' } | null;

const DEFAULT_REGENERATE_INSTRUCTIONS =
  'Improve clarity, structure, and flow while preserving verified facts.';

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  return String(value);
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .replace(/\n+/g, ' · ')
    .split(' · ')
    .map((item) => item.trim())
    .filter(Boolean);
}

type SourceEntry = { key: string; label: string; href?: string };

function normalizeSources(value: unknown): SourceEntry[] {
  if (!Array.isArray(value)) {
    return asList(value).map((item) => ({
      key: item,
      label: item,
      href: /^https?:\/\//i.test(item) ? item : undefined,
    }));
  }

  return value.flatMap((item, index) => {
    if (typeof item === 'string') {
      const label = item.trim();
      if (!label) return [];
      return [
        {
          key: `${label}-${index}`,
          label,
          href: /^https?:\/\//i.test(label) ? label : undefined,
        },
      ];
    }
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const url = String(record.url ?? record.href ?? record.note ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return [];
    return [{ key: `${url}-${index}`, label: url, href: url }];
  });
}

function formatDecisionLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function decisionTone(value: string): 'green' | 'amber' | 'red' | 'gray' {
  if (value === 'revise' || value === 'review') return 'amber';
  if (value === 'reject' || value === 'deny' || value === 'cancel') return 'red';
  if (value === 'approve' || value === 'handoff' || value === 'publish') return 'green';
  return 'gray';
}

function getNestedValue(item: Record<string, unknown>, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, item);
}

function getTextField(
  item: Record<string, unknown>,
  fieldName: string | undefined,
  fallback: string,
): string {
  const value = getNestedValue(item, fieldName);
  if (value !== undefined) {
    return displayValue(value);
  }
  return displayValue(item[fallback]);
}

function actionLinkClass(active?: boolean, tone?: 'green' | 'red' | 'amber'): string {
  if (active && tone === 'green') return 'font-semibold text-green-600 dark:text-green-400';
  if (active && tone === 'red') return 'font-semibold text-red-600 dark:text-red-400';
  return 'text-red-600 hover:underline dark:text-red-400';
}

export function ArticleReview({
  run,
  runId,
  token,
  onResumed,
  onRunUpdated,
  onGateBusyChange,
  compact,
  prefill,
  prefillToken,
}: WorkflowReviewProps) {
  const schema =
    run.pending_input_schema?.type === 'article_review'
      ? (run.pending_input_schema as ArticleReviewSchema)
      : null;
  const perItemMode = Boolean(schema?.per_item_decisions);
  const [decision, setDecision] = useState<ReviewDecision | ''>('');
  const [notes, setNotes] = useState('');
  const [itemDecisions, setItemDecisions] = useState<Record<string, ArticleItemDecision>>({});
  const [regenerateTarget, setRegenerateTarget] = useState<RegenerateTarget>(null);
  const [regenerateInstructions, setRegenerateInstructions] = useState(DEFAULT_REGENERATE_INSTRUCTIONS);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const items = useMemo(
    () =>
      (Array.isArray(schema?.items) ? schema.items : []).filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      ),
    [schema?.items],
  );
  const decisionOptions = (schema?.decision_options ?? ['approve', 'revise', 'reject']).filter(
    (option) => option !== 'revise',
  );
  const isHandoffStep = decisionOptions.includes('handoff');
  const sourceStepId = schema?.source_step_id;
  const decisionCounts = countItemDecisions(items, itemDecisions);
  const readyToContinue = perItemMode && allItemsDecided(items, itemDecisions);

  useEffect(() => {
    if (!prefill || prefillToken == null) return;
    if (prefill.decision && decisionOptions.includes(prefill.decision)) {
      setDecision(prefill.decision);
    }
    if (prefill.reviewNotes) setNotes(prefill.reviewNotes);
  }, [prefillToken, prefill, decisionOptions]);

  useEffect(() => {
    setItemDecisions({});
    setRegenerateTarget(null);
    setResumeError(null);
  }, [run.run_id, run.pending_step_id, items.length]);

  const gateBusy = busyRecordId != null || resuming;
  useEffect(() => {
    onGateBusyChange?.(gateBusy);
    return () => {
      onGateBusyChange?.(false);
    };
  }, [gateBusy, onGateBusyChange]);

  if (run.status === 'completed') {
    return <RunArticles run={run} compact={compact} />;
  }

  if (run.status !== 'awaiting_user' || !schema) return null;

  function setItemDecision(recordId: string, value: ArticleItemDecision) {
    setItemDecisions((current) => ({ ...current, [recordId]: value }));
    setResumeError(null);
  }

  function approveAll() {
    const next: Record<string, ArticleItemDecision> = {};
    for (const [index, item] of items.entries()) {
      next[getArticleRecordId(item, index)] = 'approve';
    }
    setItemDecisions(next);
    setResumeError(null);
  }

  async function regenerateRecords(recordIds: string[], instructions: string) {
    if (!token || !sourceStepId) {
      throw new Error('Regenerate is not available for this review gate.');
    }
    const trimmed = instructions.trim();
    if (!trimmed) {
      throw new Error('Add regeneration instructions.');
    }

    for (const recordId of recordIds) {
      setBusyRecordId(recordId);
      const response = await fetch(
        `/api/aivion/workflow/runs/${runId}/artifacts/${sourceStepId}/actions/regenerate_item`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ record_id: recordId, instructions: trimmed }),
        },
      );
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(error.detail ?? error.error ?? `Regenerate failed (${response.status})`);
      }
      setItemDecisions((current) => {
        const next = { ...current };
        delete next[recordId];
        return next;
      });
    }

    setRegenerateTarget(null);
    setRegenerateInstructions(DEFAULT_REGENERATE_INSTRUCTIONS);
    await onRunUpdated?.();
  }

  async function submitRegenerate() {
    if (!regenerateTarget) return;
    setResumeError(null);
    try {
      if (regenerateTarget.scope === 'all') {
        const recordIds = items.map((item, index) => getArticleRecordId(item, index));
        await regenerateRecords(recordIds, regenerateInstructions);
        return;
      }
      await regenerateRecords([regenerateTarget.recordId], regenerateInstructions);
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : 'Regenerate failed.');
    } finally {
      setBusyRecordId(null);
    }
  }

  async function submit() {
    setResuming(true);
    setResumeError(null);
    try {
      const input = perItemMode
        ? buildPerItemArticleReviewResumePayload({ items, itemDecisions })
        : (() => {
            if (!decision) throw new Error('Choose a decision.');
            return buildArticleReviewResumePayload({ decision, notes });
          })();

      const response = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(error.detail ?? `Request failed (${response.status})`);
      }
      onResumed();
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : 'Failed to submit decision.');
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className={compact ? 'space-y-4 p-4' : 'space-y-5 p-5 lg:p-7'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
            Human decision
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2
              className={
                compact
                  ? 'text-lg font-semibold text-text-primary'
                  : 'text-2xl font-semibold text-text-primary'
              }
            >
              {schema.title ?? 'Review'}
            </h2>
            {perItemMode && sourceStepId && (
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <button
                  type="button"
                  disabled={busyRecordId != null || resuming}
                  onClick={() => approveAll()}
                  className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  Approve All
                </button>
                <span className="text-text-tertiary">|</span>
                <button
                  type="button"
                  disabled={busyRecordId != null || resuming}
                  onClick={() => setRegenerateTarget({ scope: 'all' })}
                  className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                >
                  Regenerate All
                </button>
              </div>
            )}
          </div>
          {schema.description && (
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">{schema.description}</p>
          )}
          {perItemMode && (
            <p className="mt-2 text-sm text-text-secondary">
              {decisionCounts.decided} of {items.length} decided
              {decisionCounts.decided > 0 && (
                <>
                  {' '}
                  · {decisionCounts.approved} approved · {decisionCounts.cancelled} cancelled
                </>
              )}
            </p>
          )}
        </div>
        <div className="rounded-full border border-border-light bg-surface-secondary px-3 py-1.5 text-sm font-medium text-text-secondary">
          {items.length} draft{items.length === 1 ? '' : 's'}
        </div>
      </div>

      {perItemMode && regenerateTarget?.scope === 'all' && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/40 dark:bg-violet-950/30">
          <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
            Regenerate all drafts
          </p>
          <textarea
            rows={3}
            value={regenerateInstructions}
            onChange={(e) => setRegenerateInstructions(e.target.value)}
            className="mt-2 w-full resize-y rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-violet-400 dark:border-violet-900/50 dark:bg-surface-primary"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyRecordId != null}
              onClick={() => void submitRegenerate()}
              className="rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busyRecordId ? 'Regenerating…' : 'Regenerate all'}
            </button>
            <button
              type="button"
              disabled={busyRecordId != null}
              onClick={() => setRegenerateTarget(null)}
              className="rounded-full border border-border-light px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {items.map((item, index) => {
          const recordId = getArticleRecordId(item, index);
          const itemDecision = itemDecisions[recordId];
          const titleField = schema.title_field ?? 'title';
          const sectionField = schema.section_field ?? 'section';
          const languageField = schema.language_field ?? 'language';
          const summaryField = schema.summary_field ?? 'summary';
          const bodyField = schema.body_field ?? 'body';
          const sourceField = schema.source_citations_field ?? 'source_citations';
          const title = getTextField(item, titleField, 'title');
          const section = getTextField(item, sectionField, 'section');
          const language = getTextField(item, languageField, 'language');
          const summary = getTextField(item, summaryField, 'summary');
          const body = getTextField(item, bodyField, 'body');
          const sources = normalizeSources(getNestedValue(item, sourceField));
          const isBusy = busyRecordId === recordId;
          const showRegenerateForm =
            perItemMode &&
            regenerateTarget?.scope === 'one' &&
            regenerateTarget.recordId === recordId;

          const contentFingerprint = `${title}|${summary}|${body}`.slice(0, 120);
          return (
            <article
              key={`${recordId}-${contentFingerprint}`}
              className={`rounded-2xl border bg-surface-primary p-4 ${
                itemDecision === 'approve'
                  ? 'border-green-200 dark:border-green-900/40'
                  : itemDecision === 'cancel'
                    ? 'border-red-200 opacity-80 dark:border-red-900/40'
                    : 'border-border-light'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-text-primary">{title}</h3>
                  <p className="text-xs text-text-tertiary">
                    {section} · {language}
                  </p>
                </div>
                {perItemMode && sourceStepId ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <button
                      type="button"
                      disabled={isBusy || resuming}
                      onClick={() => setItemDecision(recordId, 'approve')}
                      className={actionLinkClass(itemDecision === 'approve', 'green')}
                    >
                      Approve
                    </button>
                    <span className="text-text-tertiary">|</span>
                    <button
                      type="button"
                      disabled={isBusy || resuming}
                      onClick={() => setItemDecision(recordId, 'cancel')}
                      className={actionLinkClass(itemDecision === 'cancel', 'red')}
                    >
                      Cancel
                    </button>
                    <span className="text-text-tertiary">|</span>
                    <button
                      type="button"
                      disabled={isBusy || resuming}
                      onClick={() => setRegenerateTarget({ scope: 'one', recordId })}
                      className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                    >
                      {isBusy ? 'Regenerating…' : 'Regenerate'}
                    </button>
                  </div>
                ) : null}
              </div>
              {itemDecision && (
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Marked {itemDecision}
                </p>
              )}
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{summary}</p>
              {body !== '—' && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-amber-600 dark:text-amber-400">
                    Preview draft body
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-secondary p-3 text-sm text-text-primary">
                    {body}
                  </div>
                </details>
              )}
              {sources.length > 0 && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Sources
                  </p>
                  <ul className="space-y-1">
                    {sources.map((source) => (
                      <li key={source.key} className="break-all text-sm text-text-secondary">
                        {source.href ? (
                          <a
                            href={source.href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
                          >
                            {source.label}
                          </a>
                        ) : (
                          source.label
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {showRegenerateForm && (
                <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900/40 dark:bg-violet-950/30">
                  <textarea
                    rows={3}
                    value={regenerateInstructions}
                    onChange={(e) => setRegenerateInstructions(e.target.value)}
                    className="w-full resize-y rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-text-primary outline-none focus:border-violet-400 dark:border-violet-900/50 dark:bg-surface-primary"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void submitRegenerate()}
                      className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {isBusy ? 'Regenerating…' : 'Regenerate'}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setRegenerateTarget(null)}
                      className="rounded-full border border-border-light px-3 py-1.5 text-xs font-medium text-text-secondary"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="space-y-4 rounded-2xl border border-border-light bg-surface-primary p-5">
        {!perItemMode && (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Decision
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {decisionOptions.map((option) => {
                  const active = decision === option;
                  const label = formatDecisionLabel(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setDecision(option)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? decisionTone(option) === 'green'
                            ? 'border-green-500 bg-green-500 text-white'
                            : decisionTone(option) === 'amber'
                              ? 'border-amber-500 bg-amber-500 text-white'
                              : decisionTone(option) === 'red'
                                ? 'border-red-500 bg-red-500 text-white'
                                : 'border-slate-500 bg-slate-500 text-white'
                          : 'border-border-light bg-surface-secondary text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {isHandoffStep && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  {schema.notes_label ?? schema.revision_notes_label ?? 'Notes'}
                </span>
                <textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full resize-y rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
                  placeholder="Add notes for the next step."
                />
              </label>
            )}
          </>
        )}

        {perItemMode && !readyToContinue && (
          <p className="text-sm text-text-secondary">
            Approve or cancel every draft to continue. Regenerate any draft that still needs changes.
          </p>
        )}

        {resumeError && <p className="text-xs text-red-500">{resumeError}</p>}
        <button
          type="button"
          disabled={resuming || busyRecordId != null || (perItemMode ? !readyToContinue : !decision)}
          onClick={() => void submit()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resuming ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="opacity-20"
                />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Continuing…
            </>
          ) : perItemMode ? (
            `Continue (${decisionCounts.decided}/${items.length})`
          ) : (
            'Submit Decision'
          )}
        </button>
      </div>
    </div>
  );
}
