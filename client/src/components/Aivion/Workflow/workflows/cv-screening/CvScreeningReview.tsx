import { useEffect, useMemo, useState } from 'react';
import type { CandidateReviewSchema, WorkflowReviewProps, WorkflowInputField } from '../../types';
import { CandidateCard, FitScoreRing } from '../../CandidateReview';
import { completedStepMap } from '../../helpers';

type GenericReviewSchema = {
  type: string;
  fields: Array<WorkflowInputField & { type: WorkflowInputField['type'] | 'readonly' }>;
};

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || !value) return [];
  return value
    .replace(/\n+/g, ' · ')
    .split(' · ')
    .map((item) => item.trim())
    .filter(Boolean);
}

function fitScoreValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unwrapFields(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== 'object') return {};
  const obj = output as Record<string, unknown>;
  const fields = obj.fields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    return fields as Record<string, unknown>;
  }
  return obj;
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(' · ');
  }
  if (typeof value === 'object') return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function FieldCard({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border-light bg-surface-primary p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className={`mt-1.5 ${strong ? 'text-base font-semibold text-text-primary' : 'text-sm text-text-primary'}`}>
        {value}
      </p>
    </div>
  );
}

export function CvScreeningReview({ run, runId, token, onResumed }: WorkflowReviewProps) {
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [cqNotes, setCqNotes] = useState('');
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [assessmentExpanded, setAssessmentExpanded] = useState(false);
  const [genericValues, setGenericValues] = useState<Record<string, string>>({});

  const schema = run.pending_input_schema?.type === 'candidate_review_form'
    ? (run.pending_input_schema as CandidateReviewSchema)
    : null;
  const genericSchema = !schema && run.pending_input_schema && 'fields' in run.pending_input_schema
    ? (run.pending_input_schema as GenericReviewSchema)
    : null;
  const iterations = schema?.iterations ?? [];
  const genericFields = genericSchema?.fields ?? [];
  const editableFields = useMemo(
    () => genericFields.filter((field) => field.type !== 'readonly'),
    [genericFields],
  );
  const completedSteps = completedStepMap(run);
  const profileData = unwrapFields(completedSteps.unscrub_profile?.output);
  const assessmentData = {
    ...unwrapFields(completedSteps.score_fit?.output),
    ...unwrapFields(completedSteps.unscrub_assessment?.output),
  };
  const candidateName = asString(profileData.full_name ?? profileData.name, 'Candidate');
  const candidateRole = asString(profileData.current_role ?? run.inputs?.role_title, '');
  const candidateExperience = asString(
    profileData.total_experience_years != null
      ? `${profileData.total_experience_years} yrs`
      : run.inputs?.experience_level,
    '',
  );
  const candidateEducation = asString(profileData.education, '');
  const fitScoreText = asString(assessmentData.fit_score, '');
  const fitScore = fitScoreValue(fitScoreText);
  const fitSummary = asString(assessmentData.fit_summary, '');
  const fitReasoning = asString(assessmentData.reasoning, '');
  const fitStrengths = splitList(assessmentData.strengths);
  const fitGaps = splitList(assessmentData.gaps);
  const fitRedFlags = splitList(assessmentData.red_flags);
  const fitRecommendation = asString(assessmentData.recommended_next_step, '');
  const initials = candidateName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    if (run.status !== 'awaiting_user' || !genericSchema) return;
    setGenericValues((prev) => {
      const next = { ...prev };
      for (const field of editableFields) {
        if (next[field.name] == null && field.default != null) {
          next[field.name] = String(field.default);
        }
      }
      return next;
    });
  }, [editableFields, genericSchema, run.status]);

  const resultObj = run.outputs?.['result'] as Record<string, unknown> | undefined;
  const rawShortlisted = resultObj?.['shortlisted_candidates'];
  const shortlistedCandidates = Array.isArray(rawShortlisted)
    ? (rawShortlisted as Record<string, unknown>[])
    : null;
  const cqRecruiterNotes = typeof resultObj?.['recruiter_notes'] === 'string'
    ? (resultObj['recruiter_notes'] as string)
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResuming(true);
    setResumeError(null);
    try {
      if (schema) {
        const input = { reviews: iterations.filter((_, i) => selectedIdxs.has(i)), recruiter_notes: cqNotes };
        const res = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ input }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { detail?: string };
          throw new Error(err.detail ?? `${res.status}`);
        }
        onResumed();
        return;
      }

      const input = Object.fromEntries(
        editableFields.map((field) => [
          field.name,
          field.name === 'recruiter_notes'
            ? cqNotes
            : genericValues[field.name] ?? String(field.default ?? ''),
        ]),
      );
      const missing = editableFields
        .filter((field) => field.required)
        .filter((field) => {
          const value = field.name === 'recruiter_notes'
            ? cqNotes
            : (genericValues[field.name] ?? String(field.default ?? ''));
          return value.trim().length === 0;
        });
      if (missing.length > 0) {
        throw new Error(`Please fill: ${missing.map((field) => field.label).join(', ')}`);
      }
      const res = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input }),
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
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Review {iterations.length} Candidate{iterations.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-text-secondary">
              {selectedIdxs.size} selected for shortlist
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIdxs(new Set(iterations.map((_, i) => i)))}
              className="text-xs text-amber-600 hover:underline dark:text-amber-400"
            >
              Select all
            </button>
            {selectedIdxs.size > 0 && (
              <>
                <span className="text-xs text-text-tertiary">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedIdxs(new Set())}
                  className="text-xs text-text-secondary hover:text-text-primary"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {iterations.map((it, i) => (
            <CandidateCard
              key={i}
              idx={i}
              iteration={it}
              selected={selectedIdxs.has(i)}
              onToggle={() => setSelectedIdxs((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              })}
            />
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border-light bg-surface-primary p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Recruiter Notes</p>
          <textarea
            rows={3}
            value={cqNotes}
            onChange={(e) => setCqNotes(e.target.value)}
            placeholder="Overall observations, next steps, or context for this batch…"
            className="w-full resize-none rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          {resumeError && <p className="text-xs text-red-500">{resumeError}</p>}
          <button
            type="submit"
            disabled={resuming}
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
              `Shortlist ${selectedIdxs.size} Candidate${selectedIdxs.size !== 1 ? 's' : ''}`
            )}
          </button>
        </form>
      </div>
    );
  }

  if (run.status === 'awaiting_user' && genericSchema) {
    return (
      <div className="space-y-6 p-5 lg:p-7">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
          <div className="rounded-2xl border border-border-light bg-surface-primary p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{initials || '?'}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">Candidate</p>
                <h2 className="mt-1 truncate text-2xl font-semibold text-text-primary">{candidateName}</h2>
                {candidateRole && <p className="mt-1 text-sm text-text-secondary">{candidateRole}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {candidateExperience && (
                    <span className="rounded-full bg-surface-secondary px-3 py-1 text-xs font-medium text-text-secondary">
                      {candidateExperience}
                    </span>
                  )}
                  {candidateEducation && (
                    <span className="rounded-full bg-surface-secondary px-3 py-1 text-xs font-medium text-text-secondary">
                      {candidateEducation}
                    </span>
                  )}
                  {fitRecommendation && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                      {fitRecommendation.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              </div>
              {fitScore != null && (
                <div className="shrink-0 pt-1">
                  <FitScoreRing score={fitScore} size={92} />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border-light bg-surface-primary p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">AI Assessment</p>
            {fitSummary && <p className="mt-2 text-lg font-semibold leading-snug text-text-primary">{fitSummary}</p>}
            {fitReasoning && (
              <p className={`mt-3 text-sm leading-relaxed text-text-secondary ${assessmentExpanded ? '' : 'line-clamp-4'}`}>
                {fitReasoning}
              </p>
            )}
            {fitReasoning.length > 180 && (
              <button
                type="button"
                onClick={() => setAssessmentExpanded((prev) => !prev)}
                className="mt-2 text-xs text-amber-600 hover:underline dark:text-amber-400"
              >
                {assessmentExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {fitStrengths.length > 0 && (
            <div className="flex h-full flex-col rounded-2xl border border-border-light bg-surface-primary p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">Strengths</p>
              <ul className="mt-3 space-y-2">
                {fitStrengths.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fitGaps.length > 0 && (
            <div className="flex h-full flex-col rounded-2xl border border-border-light bg-surface-primary p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">Gaps</p>
              <ul className="mt-3 space-y-2">
                {fitGaps.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fitRedFlags.length > 0 && (
            <div className="flex h-full flex-col rounded-2xl border border-border-light bg-surface-primary p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700 dark:text-red-400">Red Flags</p>
              <ul className="mt-3 space-y-2">
                {fitRedFlags.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-border-light bg-surface-primary p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">Your Decision</p>
              <p className="mt-1 text-sm text-text-secondary">Choose the outcome, set urgency, and leave notes.</p>
            </div>
            <div className="hidden rounded-full bg-surface-secondary px-3 py-1 text-xs font-medium text-text-secondary lg:block">
              {fitRecommendation ? `AI: ${fitRecommendation.replace(/_/g, ' ')}` : 'AI assessment ready'}
            </div>
          </div>

          <div className="mt-5 space-y-4 rounded-2xl border border-border-light bg-surface-secondary p-4">
            <div className="space-y-4">
              {editableFields.map((field) => {
                if (field.name === 'recruiter_notes') {
                  return (
                    <div key={field.name}>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                        {field.label}
                      </label>
                      <textarea
                        rows={3}
                        value={cqNotes}
                        onChange={(e) => setCqNotes(e.target.value)}
                        placeholder={field.placeholder ?? 'Add observations, context, or override the AI recommendation…'}
                        className="w-full resize-none rounded-xl border border-border-light bg-surface-primary px-3 py-3 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                      />
                    </div>
                  );
                }

                if (field.name === 'final_recommendation') {
                  return (
                    <div key={field.name}>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                        {field.label} <span className="text-red-500">*</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {(field.options ?? []).map((opt) => {
                          const selected = (genericValues[field.name] ?? field.default ?? '') === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setGenericValues((prev) => ({ ...prev, [field.name]: opt }))}
                              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                                selected
                                  ? 'border-amber-500 bg-amber-500 text-white shadow-sm'
                                  : 'border-border-light bg-surface-primary text-text-secondary hover:border-border-medium hover:text-text-primary'
                              }`}
                            >
                              {opt.replace(/_/g, ' ')}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (field.name === 'priority') {
                  return (
                    <div key={field.name}>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                        {field.label} <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-2">
                        {(field.options ?? []).map((opt) => {
                          const selected = (genericValues[field.name] ?? field.default ?? '') === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setGenericValues((prev) => ({ ...prev, [field.name]: opt }))}
                              className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${
                                selected
                                  ? 'border-amber-500 bg-amber-50 text-amber-700 shadow-sm dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-300'
                                  : 'border-border-light bg-surface-primary text-text-secondary hover:text-text-primary'
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (field.type === 'select' && (field.options ?? []).length <= 4) {
                  return (
                    <div key={field.name}>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                        {field.label}{field.required && <span className="ml-1 text-red-500">*</span>}
                      </label>
                      <div className="flex gap-2">
                        {(field.options ?? []).map((opt) => {
                          const selected = (genericValues[field.name] ?? field.default ?? '') === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setGenericValues((prev) => ({ ...prev, [field.name]: opt }))}
                              className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${
                                selected
                                  ? 'border-amber-500 bg-amber-50 text-amber-700 shadow-sm dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-300'
                                  : 'border-border-light bg-surface-primary text-text-secondary hover:text-text-primary'
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={field.name}>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                      {field.label}{field.required && <span className="ml-1 text-red-500">*</span>}
                    </label>
                    <input
                      type="text"
                      value={genericValues[field.name] ?? field.default ?? ''}
                      onChange={(e) => setGenericValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full rounded-xl border border-border-light bg-surface-primary px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                  </div>
                );
              })}
            </div>
            {resumeError && <p className="text-xs text-red-500">{resumeError}</p>}
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-text-secondary">
              Review the model output, then submit the recruiter decision.
            </p>
            <button
              type="submit"
              disabled={resuming}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {resuming ? 'Submitting…' : 'Submit Decision'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (run.status === 'completed' && shortlistedCandidates !== null) {
    return (
      <div className="space-y-5">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Shortlisted Candidates
            <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              {shortlistedCandidates.length}
            </span>
          </p>
          {shortlistedCandidates.length === 0 ? (
            <p className="text-sm text-text-secondary">No candidates were shortlisted in this run.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shortlistedCandidates.map((it, i) => (
                <CandidateCard key={i} idx={i} iteration={it} readOnly />
              ))}
            </div>
          )}
          {cqRecruiterNotes && (
            <div className="mt-4 rounded-xl border border-border-light bg-surface-primary p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary">Recruiter Notes</p>
              <p className="whitespace-pre-wrap text-sm text-text-primary">{cqRecruiterNotes}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (run.status === 'completed' && genericSchema) {
    return (
      <div className="space-y-5 p-5 lg:p-7">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <div className="rounded-2xl border border-border-light bg-surface-primary p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <span className="text-sm font-bold text-amber-700 dark:text-amber-300">
                  {initials || '?'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Candidate</p>
                <h2 className="mt-1 truncate text-xl font-semibold text-text-primary">{candidateName}</h2>
                {candidateRole && <p className="mt-1 text-sm text-text-secondary">{candidateRole}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  {candidateExperience && (
                    <span className="rounded-full bg-surface-secondary px-3 py-1 text-xs font-medium text-text-secondary">
                      {candidateExperience}
                    </span>
                  )}
                  {candidateEducation && (
                    <span className="rounded-full bg-surface-secondary px-3 py-1 text-xs font-medium text-text-secondary">
                      {candidateEducation}
                    </span>
                  )}
                  {fitRecommendation && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                      {fitRecommendation.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              </div>
              {fitScore != null && (
                <div className="shrink-0">
                  <FitScoreRing score={fitScore} size={92} />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border-light bg-surface-primary p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">AI Assessment</p>
            {fitSummary && <p className="mt-2 text-base font-semibold text-text-primary">{fitSummary}</p>}
            {fitReasoning && <p className="mt-3 text-sm leading-relaxed text-text-secondary">{fitReasoning}</p>}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {fitStrengths.length > 0 && (
            <FieldCard label="Strengths" value={fitStrengths.join(' • ')} />
          )}
          {fitGaps.length > 0 && (
            <FieldCard label="Gaps" value={fitGaps.join(' • ')} />
          )}
          {fitRedFlags.length > 0 && (
            <FieldCard label="Red Flags" value={fitRedFlags.join(' • ')} />
          )}
        </div>
      </div>
    );
  }

  return null;
}
