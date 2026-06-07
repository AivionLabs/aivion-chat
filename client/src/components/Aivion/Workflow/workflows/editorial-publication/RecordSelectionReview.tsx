import { useEffect, useState } from 'react';
import type { RecordSelectionSchema, WorkflowReviewProps } from '../../types';
import { completedStepMap } from '../../helpers';

type SelectionDraft = {
  section: string;
  editorial_direction: string;
};

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function RecordSelectionReview({
  run,
  runId,
  token,
  onResumed,
  compact,
  prefill,
  prefillToken,
}: WorkflowReviewProps) {
  const schema =
    run.pending_input_schema?.type === 'record_selection'
      ? (run.pending_input_schema as RecordSelectionSchema)
      : null;
  const [selected, setSelected] = useState<Record<string, SelectionDraft>>({});
  const [editorNotes, setEditorNotes] = useState('');
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  useEffect(() => {
    if (run.status !== 'awaiting_user' || !schema || !prefill || prefillToken == null) return;
    if (prefill.editorNotes) setEditorNotes(prefill.editorNotes);
    if (!prefill.selectionIndices?.length) return;
    const idField = schema.id_field || 'id';
    const list = Array.isArray(schema.items) ? schema.items : [];
    const sections = schema.sections ?? [];
    const next: Record<string, SelectionDraft> = {};
    for (const index of prefill.selectionIndices) {
      const item = list[index - 1];
      if (!item) continue;
      const recordId = String(item[idField] ?? index - 1);
      next[recordId] = {
        section: prefill.section ?? sections[0] ?? '',
        editorial_direction: '',
      };
    }
    if (Object.keys(next).length > 0) setSelected(next);
  }, [prefillToken, prefill, run.status, schema]);

  if (run.status === 'completed') {
    const completed = completedStepMap(run);
    const result = Object.values(completed)
      .map((step) => step.output)
      .find(
        (output): output is Record<string, unknown> =>
          Boolean(
            output &&
              typeof output === 'object' &&
              'selected_count' in (output as Record<string, unknown>) &&
              Array.isArray((output as Record<string, unknown>)['items']),
          ),
      );
    if (!result) return null;
    const selectedItems = result['items'] as Record<string, unknown>[];
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Selected records
        </p>
        {selectedItems.map((item, index) => (
          <div
            key={String(item['cluster_id'] ?? item['id'] ?? index)}
            className="rounded-xl border border-border-light bg-surface-primary p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold text-text-primary">
                {displayValue(
                  item['cluster_title'] ?? item['title'] ?? item['name'],
                )}
              </p>
              {item['editorial_section'] != null && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {displayValue(item['editorial_section'])}
                </span>
              )}
            </div>
            {item['editorial_direction'] != null &&
              String(item['editorial_direction']).trim() && (
                <p className="mt-2 text-sm text-text-secondary">
                  {displayValue(item['editorial_direction'])}
                </p>
              )}
          </div>
        ))}
      </div>
    );
  }

  if (run.status !== 'awaiting_user' || !schema) return null;

  const activeSchema = schema;
  const items = Array.isArray(activeSchema.items) ? activeSchema.items : [];
  const idField = activeSchema.id_field || 'id';
  const titleField = activeSchema.title_field || 'title';
  const maxSelections = Math.max(
    1,
    Number(activeSchema.max_selections) || items.length || 1,
  );
  const selectionCount = Object.keys(selected).length;
  const sections = activeSchema.sections ?? [];
  const dedupeOutput = completedStepMap(run).deduplicate_records?.output;
  const dedupeReplay =
    typeof dedupeOutput === 'object' &&
    dedupeOutput !== null &&
    (dedupeOutput as Record<string, unknown>).replay_previous === true;

  if (items.length === 0) {
    return (
      <div className={compact ? 'space-y-3 p-4' : 'space-y-4 p-5 lg:p-7'}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
          Human decision
        </p>
        <h2
          className={
            compact
              ? 'text-lg font-semibold text-text-primary'
              : 'text-2xl font-semibold text-text-primary'
          }
        >
          {activeSchema.title ?? 'Select records'}
        </h2>
        <p className="max-w-2xl text-sm text-text-secondary">
          No scored stories are available to select. Upstream fetch, dedupe, or scoring
          may have removed every item (for example, articles already seen in a prior
          run). Try a different RSS feed or start a fresh run after new content
          appears.
        </p>
      </div>
    );
  }

  function toggle(recordId: string) {
    setSelected((current) => {
      if (current[recordId]) {
        const next = { ...current };
        delete next[recordId];
        return next;
      }
      if (Object.keys(current).length >= maxSelections) return current;
      return {
        ...current,
        [recordId]: {
          section: sections[0] ?? '',
          editorial_direction: '',
        },
      };
    });
  }

  function updateSelection(recordId: string, patch: Partial<SelectionDraft>) {
    setSelected((current) => ({
      ...current,
      [recordId]: { ...current[recordId], ...patch },
    }));
  }

  async function submit() {
    setResuming(true);
    setResumeError(null);
    try {
      const selections = Object.entries(selected).map(([record_id, draft]) => ({
        record_id,
        section: draft.section,
        editorial_direction: draft.editorial_direction.trim(),
      }));
      if (
        activeSchema.require_section &&
        selections.some((selection) => !selection.section)
      ) {
        throw new Error('Assign a section to every selected record.');
      }
      const response = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          input: {
            selections,
            editor_notes: editorNotes.trim(),
          },
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(error.detail ?? `Request failed (${response.status})`);
      }
      onResumed();
    } catch (error) {
      setResumeError(
        error instanceof Error ? error.message : 'Failed to submit selections.',
      );
    } finally {
      setResuming(false);
    }
  }

  return (
    <div className={compact ? 'space-y-4 p-4' : 'space-y-5 p-5 lg:p-7'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400">
            Human decision
          </p>
          <h2
            className={
              compact
                ? 'mt-1 text-lg font-semibold text-text-primary'
                : 'mt-1 text-2xl font-semibold text-text-primary'
            }
          >
            {activeSchema.title ?? 'Select records'}
          </h2>
          {activeSchema.description && (
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              {activeSchema.description}
            </p>
          )}
        </div>
        <div className="rounded-full border border-border-light bg-surface-secondary px-3 py-1.5 text-sm font-medium text-text-secondary">
          {selectionCount} / {maxSelections} selected
        </div>
      </div>

      {dedupeReplay && (
        <p className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          No new articles were found in this feed since your last run. Showing the
          previously seen list so you can still pick stories.
        </p>
      )}

      <div className="grid gap-3">
        {items.map((item, index) => {
          const recordId = String(item[idField] ?? index);
          const draft = selected[recordId];
          const isSelected = Boolean(draft);
          const score = activeSchema.score_field
            ? item[activeSchema.score_field]
            : null;
          return (
            <article
              key={recordId}
              className={`rounded-2xl border p-4 transition-colors ${
                isSelected
                  ? 'border-amber-400 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/20'
                  : 'border-border-light bg-surface-primary'
              }`}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggle(recordId)}
                  aria-pressed={isSelected}
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : 'border-border-medium text-transparent hover:border-amber-400'
                  }`}
                >
                  ✓
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-text-primary">
                      {displayValue(item[titleField])}
                    </h3>
                    {score != null && (
                      <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-xs font-semibold text-text-primary">
                        Score {displayValue(score)}
                      </span>
                    )}
                  </div>
                  {activeSchema.summary_field &&
                    item[activeSchema.summary_field] != null && (
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                      {displayValue(item[activeSchema.summary_field])}
                    </p>
                  )}
                  {(activeSchema.metadata_fields?.length ?? 0) > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeSchema.metadata_fields!.map((metadata) => (
                        <span
                          key={metadata.field}
                          className="rounded-lg bg-surface-secondary px-2 py-1 text-xs text-text-secondary"
                        >
                          {metadata.label}: {displayValue(item[metadata.field])}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {isSelected &&
                (sections.length > 0 || activeSchema.allow_editorial_direction) && (
                <div className="ml-9 mt-4 grid gap-3 border-t border-amber-200 pt-4 dark:border-amber-800/50 md:grid-cols-[180px_1fr]">
                  {sections.length > 0 && (
                    <label className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                      Section
                      <select
                        value={draft.section}
                        onChange={(event) =>
                          updateSelection(recordId, { section: event.target.value })
                        }
                        className="mt-1.5 w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm font-normal normal-case tracking-normal text-text-primary"
                      >
                        {sections.map((section) => (
                          <option key={section} value={section}>
                            {section}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {activeSchema.allow_editorial_direction && (
                    <label className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                      Editorial direction
                      <textarea
                        rows={2}
                        value={draft.editorial_direction}
                        onChange={(event) =>
                          updateSelection(recordId, {
                            editorial_direction: event.target.value,
                          })
                        }
                        placeholder="Angle, audience, questions to answer, or evidence to verify"
                        className="mt-1.5 w-full resize-y rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm font-normal normal-case leading-relaxed tracking-normal text-text-primary"
                      />
                    </label>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {activeSchema.allow_editor_notes && (
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Issue notes
          <textarea
            rows={3}
            value={editorNotes}
            onChange={(event) => setEditorNotes(event.target.value)}
            placeholder="Cross-story direction, issue theme, or research priorities"
            className="mt-1.5 w-full resize-y rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-sm font-normal normal-case leading-relaxed tracking-normal text-text-primary"
          />
        </label>
      )}

      {resumeError && <p className="text-sm text-red-500">{resumeError}</p>}
      <button
        type="button"
        disabled={resuming || selectionCount === 0}
        onClick={() => void submit()}
        className="flex w-full items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {resuming
          ? 'Submitting selection…'
          : `Continue with ${selectionCount} selected ${selectionCount === 1 ? 'record' : 'records'}`}
      </button>
    </div>
  );
}
