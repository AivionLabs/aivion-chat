import { useState } from 'react';
import type { CandidateReviewSchema, WorkflowReviewProps } from '../types';
import { CandidateCard } from '../CandidateReview';

export function CvScreeningReview({ run, runId, token, onResumed }: WorkflowReviewProps) {
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set());
  const [cqNotes, setCqNotes] = useState('');
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const schema = run.pending_input_schema?.type === 'candidate_review_form'
    ? (run.pending_input_schema as CandidateReviewSchema)
    : null;
  const iterations = schema?.iterations ?? [];

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
    const reviews = iterations.filter((_, i) => selectedIdxs.has(i));
    try {
      const res = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input: { reviews, recruiter_notes: cqNotes } }),
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

  return null;
}
