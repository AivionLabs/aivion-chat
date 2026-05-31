import { useState } from 'react';

import { REC_CHIP, REC_LABELS } from './constants';
import { getNested } from './helpers';

export function FitScoreRing({ score, size = 88 }: { score: number; size?: number }) {
  const clamped = Math.min(10, Math.max(0, score));
  const half = size / 2;
  const r = half - 10;
  const circ = 2 * Math.PI * r;
  const filled = (clamped / 10) * circ;
  const color = clamped >= 7 ? '#22c55e' : clamped >= 5 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Fit score ${clamped}/10`} className="shrink-0">
      <circle cx={half} cy={half} r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-surface-secondary" />
      <circle
        cx={half} cy={half} r={r} fill="none"
        stroke={color} strokeWidth="7"
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${half} ${half})`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x={half} y={half + size * 0.07} textAnchor="middle" fontSize={Math.round(size * 0.25)} fontWeight="700" fill={color}>{clamped}</text>
      <text x={half} y={half + size * 0.23} textAnchor="middle" fontSize={Math.max(8, Math.round(size * 0.12))} fill="#9ca3af">/10</text>
    </svg>
  );
}

export function CandidateCard({
  iteration,
  idx,
  selected = false,
  onToggle,
  readOnly = false,
}: {
  iteration: Record<string, unknown>;
  idx: number;
  selected?: boolean;
  onToggle?: () => void;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const rawName = getNested(iteration, 'unscrub_profile.full_name');
  const name = rawName != null ? String(rawName) : `Candidate ${idx + 1}`;
  const rawRole = getNested(iteration, 'unscrub_profile.current_role');
  const currentRole = rawRole != null ? String(rawRole) : '';
  const years = getNested(iteration, 'unscrub_profile.total_experience_years');
  const rawSummary = getNested(iteration, 'unscrub_match.summary');
  const summary = rawSummary != null ? String(rawSummary) : '';
  const rawAiRec = getNested(iteration, 'unscrub_match.recruiter_action_recommended');
  const aiRec = rawAiRec != null ? String(rawAiRec) : '';
  const signals = getNested(iteration, 'unscrub_match.standout_signals');
  const flags = getNested(iteration, 'unscrub_match.yellow_flags');

  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  const cardCls = readOnly
    ? 'rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800/40 dark:bg-green-900/10'
    : `rounded-xl border p-4 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/40 ${
        selected
          ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20'
          : 'border-border-light bg-surface-primary hover:border-border-medium'
      }`;

  const interactiveProps = readOnly ? {} : {
    role: 'checkbox' as const,
    'aria-checked': selected,
    tabIndex: 0,
    onClick: onToggle,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') onToggle?.(); },
  };

  return (
    <div className={cardCls} {...interactiveProps}>
      <div className="flex items-start gap-3">
        {readOnly ? (
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3 text-green-600 dark:text-green-400" aria-hidden>
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : (
          <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
            selected ? 'border-amber-500 bg-amber-500' : 'border-border-medium bg-transparent'
          }`}>
            {selected && (
              <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3 text-white" aria-hidden>
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        )}

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{initials || '?'}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
              {currentRole && <p className="truncate text-xs text-text-secondary">{currentRole}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {years != null && String(years) !== '' && (
                <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary">
                  {String(years)} yrs
                </span>
              )}
              {aiRec && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${REC_CHIP[aiRec] ?? 'bg-surface-secondary text-text-secondary'}`}>
                  {REC_LABELS[aiRec] ?? aiRec.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>

          {summary && (
            <p className={`mt-2 text-xs leading-relaxed text-text-secondary ${expanded ? '' : 'line-clamp-2'}`}>
              {summary}
            </p>
          )}

          {summary.length > 120 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
              className="mt-1 text-xs text-amber-600 hover:underline dark:text-amber-400"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}

          {Array.isArray(signals) && (signals as unknown[]).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(signals as string[]).map((s, i) => (
                <span key={i} className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {String(s)}
                </span>
              ))}
            </div>
          )}

          {Array.isArray(flags) && (flags as unknown[]).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(flags as string[]).map((f, i) => (
                <span key={i} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {String(f)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
