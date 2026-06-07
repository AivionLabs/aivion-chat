/* eslint-disable i18next/no-literal-string */
import { cn } from '~/utils';
import type { RunTimelineItem } from './completed-run-timeline';

const TONE_DOT: Record<NonNullable<RunTimelineItem['tone']>, string> = {
  default: 'border-amber-500 bg-amber-500',
  success: 'border-green-500 bg-green-500',
  warning: 'border-orange-500 bg-orange-500',
  muted: 'border-border-light bg-text-tertiary',
};

const TONE_CARD: Record<NonNullable<RunTimelineItem['tone']>, string> = {
  default: 'border-border-light bg-surface-primary',
  success: 'border-green-200/80 bg-green-50/50 dark:border-green-900/40 dark:bg-green-950/20',
  warning: 'border-orange-200/80 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-950/20',
  muted: 'border-border-light bg-surface-secondary/60',
};

interface Props {
  items: RunTimelineItem[];
  compact?: boolean;
  title?: string;
}

export default function CompletedRunTimeline({ items, compact, title = 'Run timeline' }: Props) {
  if (!items.length) return null;

  return (
    <div
      className={cn(
        'rounded-xl border border-border-light',
        compact ? 'bg-surface-primary p-4' : 'bg-surface-primary p-5',
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{title}</p>
        <span className="text-[10px] text-text-tertiary">Deterministic summary · no AI</span>
      </div>

      <div className="relative space-y-4 pl-6">
        <div className="absolute bottom-1 left-2 top-1 w-px bg-border-light" />
        {items.map((item) => {
          const tone = item.tone ?? 'default';
          return (
            <div key={item.id} className="relative">
              <div
                className={cn(
                  'absolute -left-4 top-1.5 h-3 w-3 rounded-full border-2 bg-surface-primary',
                  TONE_DOT[tone],
                )}
              />
              <div className={cn('rounded-xl border px-4 py-3', TONE_CARD[tone])}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary">{item.title}</p>
                  {item.timestamp && (
                    <span className="text-[10px] text-text-tertiary">{item.timestamp}</span>
                  )}
                </div>
                {item.description && (
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">{item.description}</p>
                )}
                {item.details && item.details.length > 0 && (
                  <dl className="mt-2 space-y-1.5">
                    {item.details.map((detail) => (
                      <div key={`${item.id}-${detail.label}`} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
                        <dt className="text-text-tertiary">{detail.label}</dt>
                        <dd className="whitespace-pre-wrap text-text-primary">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
