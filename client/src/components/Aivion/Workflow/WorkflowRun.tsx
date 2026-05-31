import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import type {
  Workflow,
  WorkflowInputField,
  WorkflowRun,
  WorkflowReviewProps,
  WorkflowStep,
} from './types';
import { TAG_COLOR_CLASSES, STATUS_LABEL, STATUS_BADGE, REC_LABELS, REC_OPTS, PRIORITY_OPTS } from './constants';
import { completedStepMap, daysUntil, splitDots } from './helpers';
import { useRunStream } from './useRunStream';
import { ReportOutput, PendingPromptView, ResultFallback } from './ReportOutput';
import { FitScoreRing } from './CandidateReview';
import { CvScreeningReview } from './workflows/cv-screening';
import { SocialMediaPostReview } from './workflows/social-media-post';

const WORKFLOW_REVIEW: Record<string, ComponentType<WorkflowReviewProps>> = {
  'cv-screening': CvScreeningReview,
  'social-media-post': SocialMediaPostReview,
};

export { STATUS_LABEL, STATUS_BADGE };

export default function WorkflowRunPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { token } = useAuthContext();

  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [resumeValues, setResumeValues] = useState<Record<string, string>>({});
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [assessmentExpanded, setAssessmentExpanded] = useState(false);
  // Tracks which runId we've already done a completion re-fetch for to avoid loops
  const completionFetchedRef = useRef<string | null>(null);

  const onUpdate = useCallback((data: WorkflowRun) => {
    setRun((prev) => {
      if (!prev) return data;
      // Pub/sub events only carry {run_id, status} — preserve existing outputs
      // and pending fields that the new partial event omits (null/undefined).
      const merged: WorkflowRun = { ...prev, ...data };
      if (data.outputs == null && prev.outputs != null) merged.outputs = prev.outputs;
      if (data.pending_input_schema == null && prev.pending_input_schema != null) {
        merged.pending_input_schema = prev.pending_input_schema;
      }
      if (data.pending_step_id == null && prev.pending_step_id != null) {
        merged.pending_step_id = prev.pending_step_id;
      }
      if (data.pending_prompt == null && prev.pending_prompt != null) {
        merged.pending_prompt = prev.pending_prompt;
      }
      return merged;
    });
    setLoading(false);
  }, []);

  const onDone = useCallback(() => {
    setLoading(false);
  }, []);

  useRunStream(runId, token, streamKey, onUpdate, onDone);

  // Initial REST fetch — seeds full run state (including outputs + pending fields).
  // SSE alone can deliver partial pub/sub payloads that omit these fields.
  useEffect(() => {
    if (!runId || !token) return;
    fetch(`/api/aivion/workflow/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WorkflowRun | null) => {
        if (data) setRun(data);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [runId, token]);

  // Re-fetch full run when status becomes completed/failed — SSE events are
  // often partial (no outputs) so we always want a fresh REST snapshot here.
  useEffect(() => {
    if (!run || !runId || !token) return;
    if (run.status !== 'completed' && run.status !== 'failed') return;
    const key = `${runId}-${run.status}`;
    if (completionFetchedRef.current === key) return;
    completionFetchedRef.current = key;
    fetch(`/api/aivion/workflow/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WorkflowRun | null) => {
        if (!data) return;
        // Merge: keep pending_input_schema from in-memory so the review panel
        // stays visible even after the REST endpoint clears it on completion.
        setRun((prev) => prev ? {
          ...data,
          pending_input_schema: prev.pending_input_schema ?? data.pending_input_schema,
          pending_prompt: prev.pending_prompt ?? data.pending_prompt,
        } : data);
      })
      .catch(() => undefined);
  }, [run?.status, runId, token]);

  // Fetch workflow definition for step labels and output spec
  useEffect(() => {
    if (!token || !id) return;
    fetch(`/api/aivion/workflow/workflows/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((wf: Workflow | null) => { if (wf) setWorkflow(wf); })
      .catch(() => undefined);
  }, [id, token]);

  // Seed resume form defaults when awaiting_user — skip readonly display fields
  useEffect(() => {
    if (run?.status !== 'awaiting_user') return;
    const pendingSchema = run.pending_input_schema;
    const schemaFields = pendingSchema &&
      pendingSchema.type !== 'candidate_review_form' &&
      pendingSchema.type !== 'social_media_post'
      ? ((pendingSchema as { type: string; fields?: WorkflowInputField[] }).fields ?? [])
      : [];
    const fields = schemaFields.filter(
      (f) => (f.type as string) !== 'readonly',
    );
    if (fields.length === 0) return;
    setResumeValues((prev) => {
      const seeded = { ...prev };
      for (const f of fields) {
        if (!(f.name in seeded) && f.default != null) {
          seeded[f.name] = String(f.default);
        }
      }
      return seeded;
    });
  }, [run?.status, run?.pending_input_schema]);

  // Persist review-gate schema to localStorage so the completed view can
  // still show the full assessment after the REST endpoint clears pending fields.
  useEffect(() => {
    if (run?.status !== 'awaiting_user' || !run.pending_input_schema || !runId) return;
    try {
      localStorage.setItem(`wf_review_${runId}`, JSON.stringify({ schema: run.pending_input_schema }));
    } catch {}
  }, [run?.status, run?.pending_input_schema, runId]);

  // ⌘+Enter keyboard shortcut to submit review
  useEffect(() => {
    if (run?.status !== 'awaiting_user') return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('review-gate-form')?.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run?.status]);

  async function handleResume(e: React.FormEvent) {
    e.preventDefault();
    setResuming(true);
    setResumeError(null);
    try {
      // Strip display-only _-prefixed readonly fields before sending to backend
      const payload = Object.fromEntries(
        Object.entries(resumeValues).filter(([k]) => !k.startsWith('_')),
      );
      const res = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `${res.status}`);
      }
      setStreamKey((k) => k + 1);
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Failed to submit.');
    } finally {
      setResuming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-text-secondary">Run not found.</p>
        <Link to={`/workflow/${id}`} className="text-sm text-amber-600 hover:underline">
          ← Back
        </Link>
      </div>
    );
  }

  const steps: WorkflowStep[] = workflow?.spec?.steps ?? [];
  const done = completedStepMap(run);
  const currentStep = steps.find((s) => s.id === run.pending_step_id);
  const specOutput = workflow?.spec?.output;

  // For completed runs: restore review schema from in-memory (SSE merge kept it)
  // or localStorage (page reload case). This lets the completed view show the
  // full assessment without a form.
  let effectiveSchema = run.pending_input_schema;
  if (!effectiveSchema && runId) {
    try {
      const raw = localStorage.getItem(`wf_review_${runId}`);
      if (raw) effectiveSchema = (JSON.parse(raw) as { schema: typeof run.pending_input_schema })?.schema ?? null;
    } catch {}
  }

  const isCandidateReview = effectiveSchema?.type === 'candidate_review_form';
  const isCustomReviewSchema = effectiveSchema?.type === 'social_media_post';
  const CustomReview = workflow?.slug ? WORKFLOW_REVIEW[workflow.slug] : undefined;

  const reviewAllFields = isCandidateReview || isCustomReviewSchema || !effectiveSchema
    ? []
    : ((effectiveSchema as { type: string; fields?: WorkflowInputField[] }).fields ?? []);
  const roFields = Object.fromEntries(
    reviewAllFields
      .filter((f) => (f.type as string) === 'readonly')
      .map((f) => [f.name, String(f.default ?? '—')]),
  );
  const reviewEditFields = reviewAllFields.filter((f) => (f.type as string) !== 'readonly');
  const reviewDisplay = workflow?.spec?.review_display;
  const recField = reviewDisplay?.rec_field ?? '_ai_rec';
  const aiRec = roFields[recField] && roFields[recField] !== '—' ? roFields[recField] : null;

  function fieldLabel(key: string): string {
    return reviewAllFields.find((f) => f.name === key)?.label
      ?? key.replace(/^_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const profileValues = (reviewDisplay?.profile_fields ?? []).map((key) =>
    (roFields[key] && roFields[key] !== '—') ? roFields[key] : String(run.inputs?.[key] ?? ''),
  ).filter(Boolean);
  // Generic entity identity — profile_fields[0] is the primary title, [1] the subtitle (person, doc, contract, etc.)
  const entityName = profileValues[0] ?? '';
  const entitySubtitle = profileValues[1] ?? '';
  const entityInitials = entityName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Main panel ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-y-auto">

        {/* Running */}
        {run.status === 'running' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <svg className="h-12 w-12 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-base font-semibold text-text-primary">
                {currentStep?.label ?? 'Processing…'}
              </p>
              <p className="mt-1 text-sm text-text-secondary">Running step — this may take a moment</p>
            </div>
          </div>
        )}

        {/* Pending */}
        {run.status === 'pending' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <p className="text-sm text-text-secondary">Queued — starting soon…</p>
          </div>
        )}

        {/* awaiting_oauth — service disconnected mid-run */}
        {run.status === 'awaiting_oauth' && (
          <div className="p-6 lg:p-8">
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
              <div className="flex items-start gap-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-semibold text-red-800 dark:text-red-300">Service connection required</p>
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                    A service this workflow needs is no longer connected. Reconnect it to resume the run.
                  </p>
                  <Link
                    to="/connections"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Manage connections →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* awaiting_user */}
        {run.status === 'awaiting_user' && (
          <div className="flex-1">
            {/* ── Sticky decision bar ─────────────────────────────────────────── */}
            {reviewDisplay && (
              <div className="sticky top-0 z-10 border-b border-border-light bg-surface-primary/95 px-5 py-3 backdrop-blur-sm lg:px-7">
                <div className="flex items-center gap-3">
                  <div className="flex shrink-0 items-center gap-2">
                    {entityName && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                        <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{entityInitials}</span>
                      </div>
                    )}
                    <div className="hidden min-w-0 sm:block">
                      <p className="text-sm font-semibold leading-tight text-text-primary">{entityName || (workflow?.name ?? '')}</p>
                      {entitySubtitle && (
                        <p className="max-w-[160px] truncate text-[11px] text-text-secondary">{entitySubtitle}</p>
                      )}
                    </div>
                  </div>
                  {reviewDisplay.score_field && roFields[reviewDisplay.score_field] && roFields[reviewDisplay.score_field] !== '—' && (
                    <FitScoreRing score={parseFloat(roFields[reviewDisplay.score_field])} size={52} />
                  )}
                  <div className="mx-1 h-8 w-px shrink-0 bg-border-light" />
                  {aiRec && (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-xs text-text-secondary sm:inline">AI:</span>
                      <span className="text-xs font-semibold text-text-primary">
                        {REC_LABELS[aiRec] ?? aiRec.replace(/_/g, ' ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setResumeValues((p) => ({ ...p, final_recommendation: aiRec, priority: p['priority'] || 'medium' }))}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300"
                      >
                        ✓ Accept
                      </button>
                    </div>
                  )}
                  <div className="flex-1" />
                  {resumeValues['final_recommendation'] && (
                    <span className="shrink-0 rounded-full bg-surface-secondary px-2.5 py-1 text-xs font-medium text-text-secondary">
                      → {REC_LABELS[resumeValues['final_recommendation']] ?? resumeValues['final_recommendation']}
                    </span>
                  )}
                  <button
                    type="submit"
                    form="review-gate-form"
                    disabled={resuming || !resumeValues['final_recommendation']}
                    className="shrink-0 flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {resuming && (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    Submit Decision
                  </button>
                </div>
              </div>
            )}

            {/* ── Main content ─────────────────────────────────────────────────── */}
            <div className="p-5 lg:p-7">
              {run.expires_at && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  Expires in {daysUntil(run.expires_at)} day{daysUntil(run.expires_at) === 1 ? '' : 's'}
                </div>
              )}

              {reviewDisplay ? (
                <div className="space-y-4">
                  {/* Row 1: Profile + AI Assessment */}
                  <div className="grid grid-cols-2 gap-4">
                    {(reviewDisplay.profile_fields?.length ?? 0) > 0 && (
                      <div className="rounded-xl border border-border-light bg-surface-primary p-5">
                        <div className="mb-4 flex items-center gap-3">
                          {entityName && (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                              <span className="text-base font-bold text-amber-700 dark:text-amber-300">{entityInitials}</span>
                            </div>
                          )}
                          <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                            {reviewDisplay.profile_label ?? 'Details'}
                          </p>
                        </div>
                        <div className="space-y-3">
                          {reviewDisplay.profile_fields!.map((key) => {
                            const value = roFields[key] && roFields[key] !== '—'
                              ? roFields[key]
                              : String(run.inputs?.[key] ?? '');
                            return value ? (
                              <div key={key}>
                                <p className="text-xs text-text-tertiary">{fieldLabel(key)}</p>
                                <p className="mt-0.5 text-sm font-medium text-text-primary">{value}</p>
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                    )}
                    {(reviewDisplay.assessment_fields?.length ?? 0) > 0 && (
                      <div className="rounded-xl border border-border-light bg-surface-primary p-5">
                        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                          {reviewDisplay.assessment_label ?? 'AI Assessment'}
                        </p>
                        <div className="flex items-start gap-4">
                          {reviewDisplay.score_field && roFields[reviewDisplay.score_field] && roFields[reviewDisplay.score_field] !== '—' && (
                            <FitScoreRing score={parseFloat(roFields[reviewDisplay.score_field])} />
                          )}
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {reviewDisplay.assessment_fields!
                              .filter((key) => key !== reviewDisplay.score_field)
                              .map((key, idx) => {
                                const value = roFields[key];
                                if (!value || value === '—') return null;
                                if (idx > 0 && !assessmentExpanded) return null;
                                return (
                                  <p key={key} className={`text-sm ${idx === 0 ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
                                    {value}
                                  </p>
                                );
                              })}
                            {reviewDisplay.assessment_fields!.filter(
                              (key) => key !== reviewDisplay.score_field && roFields[key] && roFields[key] !== '—',
                            ).length > 1 && (
                              <button
                                type="button"
                                onClick={() => setAssessmentExpanded((p) => !p)}
                                className="mt-1 text-xs text-amber-600 hover:underline dark:text-amber-400"
                              >
                                {assessmentExpanded ? 'Show less' : 'Show rationale'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Tag groups */}
                  {(reviewDisplay.tag_groups?.length ?? 0) > 0 && (() => {
                    const activeGroups = reviewDisplay.tag_groups!.filter(
                      (g) => splitDots(roFields[g.field] ?? '').length > 0,
                    );
                    if (!activeGroups.length) return null;
                    return (
                      <div className="flex gap-4">
                        {activeGroups.map((group) => {
                          const items = splitDots(roFields[group.field] ?? '');
                          const cls = TAG_COLOR_CLASSES[group.color] ?? TAG_COLOR_CLASSES.gray;
                          return (
                            <div key={group.field} className={`flex-1 rounded-xl border ${cls.border} ${cls.bg} p-4`}>
                              <p className={`mb-2.5 text-xs font-semibold uppercase tracking-wider ${cls.title}`}>
                                {group.label}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {items.map((item, i) => (
                                  <span key={i} className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls.chip}`}>{item}</span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Row 3: Decision form */}
                  <div className="rounded-xl border border-border-light bg-surface-primary p-5">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-secondary">Your Decision</p>
                    <form id="review-gate-form" onSubmit={handleResume} className="space-y-5">
                      {reviewEditFields.find((f) => f.name === 'final_recommendation') && (
                        <div>
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
                            Decision <span className="text-red-500">*</span>
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {REC_OPTS.map((opt) => {
                              const selected = resumeValues['final_recommendation'] === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setResumeValues((p) => ({ ...p, final_recommendation: opt.value }))}
                                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                                    selected
                                      ? opt.active + ' ring-2 ring-current ring-offset-1'
                                      : 'border-border-light bg-surface-secondary text-text-secondary hover:border-border-medium hover:text-text-primary'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {reviewEditFields.find((f) => f.name === 'priority') && (
                        <div>
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-secondary">Priority</label>
                          <div className="flex gap-1.5">
                            {PRIORITY_OPTS.map((opt) => {
                              const selected = resumeValues['priority'] === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setResumeValues((p) => ({ ...p, priority: opt.value }))}
                                  className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-all ${
                                    selected
                                      ? opt.active + ' ring-1 ring-current'
                                      : 'border-border-light bg-surface-secondary text-text-secondary hover:text-text-primary'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {reviewEditFields.find((f) => f.name === 'recruiter_notes') && (
                        <div>
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-text-secondary">Your Notes</label>
                          <textarea
                            rows={3}
                            className="w-full resize-none rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                            placeholder="Add observations, context, or override the AI recommendation…"
                            value={resumeValues['recruiter_notes'] ?? ''}
                            onChange={(e) => setResumeValues((p) => ({ ...p, recruiter_notes: e.target.value }))}
                          />
                        </div>
                      )}
                      {reviewEditFields
                        .filter((f) => !['final_recommendation', 'priority', 'recruiter_notes'].includes(f.name))
                        .map((f) => (
                          <div key={f.name}>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
                              {f.label}
                              {f.required && <span className="ml-1 text-red-500">*</span>}
                            </label>
                            {f.type === 'select' ? (
                              <select
                                className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                                value={resumeValues[f.name] ?? ''}
                                onChange={(e) => setResumeValues((p) => ({ ...p, [f.name]: e.target.value }))}
                              >
                                {(f.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : (
                              <input
                                type="text"
                                className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                                value={resumeValues[f.name] ?? ''}
                                onChange={(e) => setResumeValues((p) => ({ ...p, [f.name]: e.target.value }))}
                                placeholder={f.placeholder}
                              />
                            )}
                          </div>
                        ))}
                      {resumeError && (
                        <p className="text-xs text-red-500">{resumeError}</p>
                      )}
                      <button
                        type="submit"
                        disabled={resuming || !resumeValues['final_recommendation']}
                        title="⌘+Enter"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resuming ? (
                          <>
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Submitting…
                          </>
                        ) : (
                          <>
                            Submit Decision
                            <kbd className="ml-1 rounded bg-amber-400/60 px-1.5 py-0.5 text-xs font-normal">⌘↵</kbd>
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                </div>
              ) : CustomReview ? (
                <CustomReview run={run} workflow={workflow} runId={runId!} token={token!} onResumed={() => setStreamKey((k) => k + 1)} />
              ) : (
                <div className="space-y-6">
                  {specOutput && (
                    <ReportOutput output={specOutput} completedSteps={done} inputs={run.inputs ?? {}} />
                  )}
                  {run.pending_prompt && (
                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">AI Assessment</p>
                      <div className="rounded-2xl border border-border-light bg-surface-primary p-5">
                        <PendingPromptView raw={run.pending_prompt} />
                      </div>
                    </div>
                  )}
                  {reviewEditFields.length > 0 && (
                    <div className="space-y-4">
                      {/* Readonly info fields shown as contextual links above the form */}
                      {reviewAllFields.filter((f) => (f.type as string) === 'readonly').map((f) => {
                        const val = String(f.default ?? '');
                        if (!val || val === '—') return null;
                        const isUrl = /^https?:\/\//.test(val);
                        return (
                          <div key={f.name} className="flex items-center gap-3 rounded-xl border border-border-light bg-surface-secondary px-4 py-3">
                            <svg className="h-4 w-4 shrink-0 text-text-tertiary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                              <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                            </svg>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-text-tertiary">{f.label}</p>
                              {isUrl ? (
                                <a href={val} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-amber-600 hover:underline dark:text-amber-400">
                                  {val}
                                </a>
                              ) : (
                                <p className="truncate text-sm text-text-primary">{val}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div className="rounded-xl border border-border-light bg-surface-primary p-5">
                        <form id="review-gate-form" onSubmit={handleResume} className="space-y-5">
                          {reviewEditFields.map((f) => {
                            if (f.type === 'textarea') {
                              const charCount = (resumeValues[f.name] ?? '').length;
                              return (
                                <div key={f.name}>
                                  <div className="mb-2 flex items-center justify-between">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                                      {f.label}{f.required && <span className="ml-1 text-red-500">*</span>}
                                    </label>
                                    <span className="tabular-nums text-xs text-text-tertiary">{charCount.toLocaleString()} chars</span>
                                  </div>
                                  <textarea
                                    rows={10}
                                    className="w-full resize-y rounded-lg border border-border-light bg-surface-secondary px-3 py-3 text-sm leading-relaxed text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                                    value={resumeValues[f.name] ?? ''}
                                    onChange={(e) => setResumeValues((p) => ({ ...p, [f.name]: e.target.value }))}
                                    placeholder="Edit the post text before publishing…"
                                  />
                                </div>
                              );
                            }

                            if (f.type === 'select' && (f.options ?? []).length <= 4) {
                              const DECISION_STYLE: Record<string, { active: string; inactive: string; icon: string }> = {
                                publish: {
                                  active: 'bg-green-500 border-green-500 text-white shadow-sm',
                                  inactive: 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100 dark:border-green-700/50 dark:text-green-400 dark:bg-green-900/10 dark:hover:bg-green-900/20',
                                  icon: '✓',
                                },
                                reject: {
                                  active: 'bg-red-500 border-red-500 text-white shadow-sm',
                                  inactive: 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100 dark:border-red-700/50 dark:text-red-400 dark:bg-red-900/10 dark:hover:bg-red-900/20',
                                  icon: '✕',
                                },
                              };
                              return (
                                <div key={f.name}>
                                  <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
                                    {f.label}{f.required && <span className="ml-1 text-red-500">*</span>}
                                  </label>
                                  <div className="flex gap-3">
                                    {(f.options ?? []).map((opt) => {
                                      const selected = resumeValues[f.name] === opt;
                                      const style = DECISION_STYLE[opt] ?? {
                                        active: 'bg-amber-500 border-amber-500 text-white',
                                        inactive: 'border-border-light bg-surface-secondary text-text-secondary hover:text-text-primary',
                                        icon: '·',
                                      };
                                      return (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() => setResumeValues((p) => ({ ...p, [f.name]: opt }))}
                                          className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${selected ? style.active : style.inactive}`}
                                        >
                                          <span>{style.icon}</span>
                                          {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={f.name}>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
                                  {f.label}{f.required && <span className="ml-1 text-red-500">*</span>}
                                </label>
                                <input
                                  type="text"
                                  className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                                  value={resumeValues[f.name] ?? ''}
                                  onChange={(e) => setResumeValues((p) => ({ ...p, [f.name]: e.target.value }))}
                                  placeholder={f.placeholder}
                                />
                              </div>
                            );
                          })}
                          {resumeError && <p className="text-xs text-red-500">{resumeError}</p>}
                          {(() => {
                            const decision = resumeValues['decision'];
                            const hasRequiredSelects = reviewEditFields
                              .filter((f) => f.type === 'select' && f.required)
                              .every((f) => !!resumeValues[f.name]);
                            const btnCls = decision === 'publish'
                              ? 'bg-green-500 hover:bg-green-600'
                              : decision === 'reject'
                                ? 'bg-red-500 hover:bg-red-600'
                                : 'bg-amber-500 hover:bg-amber-600';
                            return (
                              <button
                                type="submit"
                                disabled={resuming || !hasRequiredSelects}
                                title="⌘+Enter"
                                className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${btnCls}`}
                              >
                                {resuming ? (
                                  <>
                                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
                                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Submitting…
                                  </>
                                ) : decision === 'publish' ? (
                                  <>Publish Post <kbd className="ml-1 rounded bg-green-400/60 px-1.5 py-0.5 text-xs font-normal">⌘↵</kbd></>
                                ) : decision === 'reject' ? (
                                  'Reject'
                                ) : (
                                  'Submit'
                                )}
                              </button>
                            );
                          })()}
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Failed */}
        {run.status === 'failed' && (
          <div className="p-6 lg:p-8">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {run.error_message ?? 'The run failed without an error message.'}
            </div>
          </div>
        )}

        {/* Completed */}
        {run.status === 'completed' && (
          <div className="flex-1 overflow-y-auto p-5 lg:p-7">
            {/* Completion banner */}
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-700/40 dark:bg-green-900/20">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-800/40">
                <svg className="h-4 w-4 text-green-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                  {workflow?.name ?? 'Workflow'} complete
                </p>
                {run.completed_at && (
                  <p className="text-xs text-green-700 dark:text-green-400">
                    {new Date(run.completed_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {reviewDisplay && reviewAllFields.length > 0 && !isCandidateReview ? (
              <div className="space-y-4">
                {/* Row 1: Profile + AI Assessment */}
                <div className="grid grid-cols-2 gap-4">
                  {(reviewDisplay.profile_fields?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-border-light bg-surface-primary p-5">
                      <div className="mb-4 flex items-center gap-3">
                        {entityName && (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                            <span className="text-base font-bold text-amber-700 dark:text-amber-300">{entityInitials}</span>
                          </div>
                        )}
                        <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                          {reviewDisplay.profile_label ?? 'Details'}
                        </p>
                      </div>
                      <div className="space-y-3">
                        {reviewDisplay.profile_fields!.map((key) => {
                          const value = roFields[key] && roFields[key] !== '—'
                            ? roFields[key]
                            : String(run.inputs?.[key] ?? '');
                          return value ? (
                            <div key={key}>
                              <p className="text-xs text-text-tertiary">{fieldLabel(key)}</p>
                              <p className="mt-0.5 text-sm font-medium text-text-primary">{value}</p>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                  {(reviewDisplay.assessment_fields?.length ?? 0) > 0 && (
                    <div className="rounded-xl border border-border-light bg-surface-primary p-5">
                      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                        {reviewDisplay.assessment_label ?? 'AI Assessment'}
                      </p>
                      <div className="flex items-start gap-4">
                        {reviewDisplay.score_field && roFields[reviewDisplay.score_field] && roFields[reviewDisplay.score_field] !== '—' && (
                          <FitScoreRing score={parseFloat(roFields[reviewDisplay.score_field])} />
                        )}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {reviewDisplay.assessment_fields!
                            .filter((key) => key !== reviewDisplay.score_field)
                            .map((key, idx) => {
                              const value = roFields[key];
                              if (!value || value === '—') return null;
                              if (idx > 0 && !assessmentExpanded) return null;
                              return (
                                <p key={key} className={`text-sm ${idx === 0 ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>
                                  {value}
                                </p>
                              );
                            })}
                          {reviewDisplay.assessment_fields!.filter(
                            (key) => key !== reviewDisplay.score_field && roFields[key] && roFields[key] !== '—',
                          ).length > 1 && (
                            <button
                              type="button"
                              onClick={() => setAssessmentExpanded((p) => !p)}
                              className="mt-1 text-xs text-amber-600 hover:underline dark:text-amber-400"
                            >
                              {assessmentExpanded ? 'Show less' : 'Show rationale'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Row 2: Tag groups */}
                {(reviewDisplay.tag_groups?.length ?? 0) > 0 && (() => {
                  const activeGroups = reviewDisplay.tag_groups!.filter(
                    (g) => splitDots(roFields[g.field] ?? '').length > 0,
                  );
                  if (!activeGroups.length) return null;
                  return (
                    <div className="flex gap-4">
                      {activeGroups.map((group) => {
                        const items = splitDots(roFields[group.field] ?? '');
                        const cls = TAG_COLOR_CLASSES[group.color] ?? TAG_COLOR_CLASSES.gray;
                        return (
                          <div key={group.field} className={`flex-1 rounded-xl border ${cls.border} ${cls.bg} p-4`}>
                            <p className={`mb-2.5 text-xs font-semibold uppercase tracking-wider ${cls.title}`}>
                              {group.label}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {items.map((item, i) => (
                                <span key={i} className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls.chip}`}>{item}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Row 3: Decision made (read-only) */}
                {(() => {
                  const outputs = run.outputs as Record<string, unknown> | null;
                  const rec = outputs?.['final_recommendation'] as string | undefined;
                  const priority = outputs?.['priority'] as string | undefined;
                  const notes = outputs?.['recruiter_notes'] as string | undefined;
                  if (!rec && !priority && !notes) return null;
                  return (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-800/40 dark:bg-green-900/10">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
                        Decision Submitted
                      </p>
                      <div className="space-y-3">
                        {rec && (
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-text-secondary w-20 shrink-0">Decision</span>
                            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700 dark:bg-green-800/30 dark:text-green-300">
                              {REC_LABELS[rec] ?? rec.replace(/_/g, ' ')}
                            </span>
                          </div>
                        )}
                        {priority && (
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-text-secondary w-20 shrink-0">Priority</span>
                            <span className="text-sm font-medium text-text-primary capitalize">{priority}</span>
                          </div>
                        )}
                        {notes && (
                          <div>
                            <span className="text-xs text-text-secondary">Notes</span>
                            <p className="mt-1 text-sm text-text-primary whitespace-pre-wrap">{notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : CustomReview ? (
              <CustomReview run={run} workflow={workflow} runId={runId!} token={token!} onResumed={() => setStreamKey((k) => k + 1)} />
            ) : specOutput ? (
              <ReportOutput output={specOutput} completedSteps={done} inputs={run.inputs ?? {}} />
            ) : run.outputs && Object.keys(run.outputs).some((k) => k !== '_completed_steps') ? (
              <ResultFallback outputs={run.outputs as Record<string, unknown>} />
            ) : null}
          </div>
        )}

        {/* Cancelled */}
        {run.status === 'cancelled' && (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-text-secondary">This run was cancelled.</p>
          </div>
        )}
      </div>
    </div>
  );
}
