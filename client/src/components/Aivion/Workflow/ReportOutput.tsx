import type { ComparisonField, WorkflowOutput, WorkflowStep } from './types';
import { CHART_COLORS, PROGRESS_STATUS } from './constants';
import { formatMetric, getNested, resolveJsonArray, resolveTemplate } from './helpers';

function FieldValue({ raw, kind }: { raw: string; kind?: string }) {
  if (kind === 'list') {
    let items: string[] = [];
    try { items = JSON.parse(raw); } catch { items = raw.split(',').map((s) => s.trim()); }
    if (!Array.isArray(items) || !items.length) return <span className="text-text-secondary">—</span>;
    return (
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" />
            {String(item)}
          </li>
        ))}
      </ul>
    );
  }
  return <span className="text-sm text-text-primary">{raw}</span>;
}

function resolveListItems(
  items: string[],
  completedSteps: Record<string, { output: unknown }>,
  inputs: Record<string, unknown>,
): string[] {
  const result: string[] = [];
  for (const tpl of items) {
    const resolved = resolveTemplate(tpl, completedSteps, inputs);
    try {
      const parsed = JSON.parse(resolved);
      if (Array.isArray(parsed)) {
        result.push(...parsed.map(String));
        continue;
      }
    } catch { /* fall through */ }
    if (resolved.trim()) result.push(resolved);
  }
  return result;
}

export function SectionTitle({ title }: { title?: string }) {
  if (!title) return null;
  return <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-secondary">{title}</p>;
}

export function ComparisonItemCard({
  item,
  fields,
}: {
  item: Record<string, unknown>;
  fields: ComparisonField[];
}) {
  return (
    <div className="rounded-xl border border-border-light bg-surface-secondary p-4 space-y-2.5">
      {fields.map((f, k) => {
        const raw = getNested(item, f.field);
        return (
          <div key={k}>
            <p className="text-xs text-text-tertiary">{f.label}</p>
            {f.kind === 'list' && Array.isArray(raw) ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {(raw as string[]).map((v, l) => (
                  <span key={l} className="rounded-full bg-surface-primary px-2 py-0.5 text-xs text-text-secondary">
                    {String(v)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-sm text-text-primary">{raw != null ? String(raw) : '—'}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ReportOutput({
  output,
  completedSteps,
  inputs,
}: {
  output: WorkflowOutput;
  completedSteps: Record<string, { output: unknown }>;
  inputs: Record<string, unknown>;
}) {
  if (!('sections' in output) || !output.sections?.length) {
    const fields = ('fields' in output ? output.fields : undefined) ?? [];
    const resolved = fields
      .map((f) => ({ ...f, resolved: resolveTemplate(f.value, completedSteps, inputs) }))
      .filter((f) => f.resolved.trim() !== '');
    if (!resolved.length) return null;
    return (
      <div className="rounded-2xl border border-border-light bg-surface-primary p-5">
        {'title' in output && output.title && <SectionTitle title={output.title} />}
        <dl className="space-y-4">
          {resolved.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-medium text-text-secondary">{f.label}</dt>
              <dd className="mt-0.5"><FieldValue raw={f.resolved} kind={f.kind} /></dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {output.sections.map((section, i) => {
        // ── key_value ──────────────────────────────────────────────────────────
        if (section.type === 'key_value') {
          const resolved = section.fields
            .map((f) => ({ ...f, resolved: resolveTemplate(f.value, completedSteps, inputs) }))
            .filter((f) => f.resolved.trim() !== '');
          if (!resolved.length) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <dl className="space-y-4">
                {resolved.map((f) => (
                  <div key={f.label}>
                    <dt className="text-xs font-medium text-text-secondary">{f.label}</dt>
                    <dd className="mt-0.5"><FieldValue raw={f.resolved} kind={f.kind} /></dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }

        // ── list ───────────────────────────────────────────────────────────────
        if (section.type === 'list') {
          const items = resolveListItems(section.items ?? [], completedSteps, inputs);
          if (!items.length) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <ul className="space-y-2">
                {items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        }

        // ── text ───────────────────────────────────────────────────────────────
        if (section.type === 'text') {
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <p className="whitespace-pre-wrap text-sm text-text-primary">{section.content}</p>
            </div>
          );
        }

        // ── metric_grid ────────────────────────────────────────────────────────
        if (section.type === 'metric_grid') {
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {section.metrics.map((m, j) => {
                  const val = resolveTemplate(m.value, completedSteps, inputs);
                  return (
                    <div key={j} className="rounded-xl bg-surface-secondary p-4">
                      <p className="text-xs text-text-tertiary">{m.label}</p>
                      <p className="mt-1 text-2xl font-bold text-text-primary">{formatMetric(val, m.format)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // ── table ──────────────────────────────────────────────────────────────
        if (section.type === 'table') {
          const rows = resolveJsonArray(section.data_table, completedSteps, inputs);
          if (!rows.length) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-light">
                      {section.columns.map((col, k) => (
                        <th key={k} className="pb-2 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-text-tertiary last:pr-0">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {rows.map((row, j) => (
                      <tr key={j}>
                        {section.columns.map((col, k) => {
                          const val = getNested(row, col.field);
                          return (
                            <td key={k} className="py-2.5 pr-6 text-text-primary last:pr-0">
                              {formatMetric(val != null ? String(val) : '—', col.format)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        // ── comparison ─────────────────────────────────────────────────────────
        if (section.type === 'comparison') {
          const items = resolveJsonArray(section.data, completedSteps, inputs);
          if (!items.length) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item, j) => (
                  <ComparisonItemCard key={j} item={item} fields={section.fields_per_item} />
                ))}
              </div>
            </div>
          );
        }

        // ── bar_chart ──────────────────────────────────────────────────────────
        if (section.type === 'bar_chart') {
          const items = resolveJsonArray(section.chart_data, completedSteps, inputs);
          if (!items.length) return null;
          const maxVal = Math.max(...items.map((d) => Number(getNested(d, section.y_field) ?? 0))) || 1;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="space-y-3">
                {items.map((item, j) => {
                  const label = String(getNested(item, section.x_field) ?? '');
                  const val = Number(getNested(item, section.y_field) ?? 0);
                  const pct = (val / maxVal) * 100;
                  return (
                    <div key={j} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-xs text-text-secondary">{label}</span>
                      <div className="flex-1 overflow-hidden rounded-full bg-surface-secondary" style={{ height: 8 }}>
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%`, transition: 'width 0.6s ease' }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs font-medium text-text-primary">
                        {val.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // ── line_chart ─────────────────────────────────────────────────────────
        if (section.type === 'line_chart') {
          const items = resolveJsonArray(section.chart_data, completedSteps, inputs);
          if (items.length < 2) return null;
          const W = 500, H = 120, PY = 16;
          const vals = items.map((d) => Number(getNested(d, section.y_field) ?? 0));
          const maxVal = Math.max(...vals) || 1;
          const pts = items.map((d, idx) => ({
            x: (idx / (items.length - 1)) * W,
            y: H - PY - ((Number(getNested(d, section.y_field) ?? 0) / maxVal) * (H - PY * 2)),
            label: String(getNested(d, section.x_field) ?? ''),
          }));
          const pathD = pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
          const fillD = `${pathD} L ${W} ${H} L 0 ${H} Z`;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full overflow-visible">
                <defs>
                  <linearGradient id={`lc-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={fillD} fill={`url(#lc-${i})`} />
                <path d={pathD} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {pts.map((p, idx) => (
                  <g key={idx}>
                    <circle cx={p.x} cy={p.y} r="4" fill="#f59e0b" />
                    <text x={p.x} y={H + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">{p.label}</text>
                  </g>
                ))}
              </svg>
            </div>
          );
        }

        // ── pie_chart ──────────────────────────────────────────────────────────
        if (section.type === 'pie_chart') {
          const items = resolveJsonArray(section.chart_data, completedSteps, inputs);
          if (!items.length) return null;
          const total = items.reduce((s, d) => s + Number(getNested(d, section.value_field) ?? 0), 0) || 1;
          const CX = 80, CY = 80, R = 70, IR = 38;
          let cum = 0;
          const slices = items.map((item, idx) => {
            const val = Number(getNested(item, section.value_field) ?? 0);
            const pct = val / total;
            const a0 = cum * 2 * Math.PI - Math.PI / 2;
            cum += pct;
            const a1 = cum * 2 * Math.PI - Math.PI / 2;
            const large = pct > 0.5 ? 1 : 0;
            const x1 = CX + R * Math.cos(a0), y1 = CY + R * Math.sin(a0);
            const x2 = CX + R * Math.cos(a1), y2 = CY + R * Math.sin(a1);
            const ix1 = CX + IR * Math.cos(a0), iy1 = CY + IR * Math.sin(a0);
            const ix2 = CX + IR * Math.cos(a1), iy2 = CY + IR * Math.sin(a1);
            return {
              label: String(getNested(item, section.label_field) ?? ''),
              pct,
              color: CHART_COLORS[idx % CHART_COLORS.length],
              path: `M ${ix1} ${iy1} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${IR} ${IR} 0 ${large} 0 ${ix1} ${iy1} Z`,
            };
          });
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="flex items-center gap-8">
                <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
                  {slices.map((s, idx) => <path key={idx} d={s.path} fill={s.color} opacity="0.9" />)}
                </svg>
                <div className="min-w-0 space-y-2">
                  {slices.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2.5">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
                      <span className="truncate text-xs text-text-primary">{s.label}</span>
                      <span className="shrink-0 text-xs text-text-secondary">{Math.round(s.pct * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }

        // ── document_preview ───────────────────────────────────────────────────
        if (section.type === 'document_preview') {
          const resolvedKey = resolveTemplate(section.storage_key, completedSteps, inputs);
          if (!resolvedKey) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary">
                  <svg className="h-5 w-5 text-text-secondary" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {section.filename ?? resolvedKey.split('/').pop() ?? resolvedKey}
                  </p>
                  <p className="text-xs text-text-tertiary">Stored in S3</p>
                </div>
              </div>
            </div>
          );
        }

        // ── timeline ───────────────────────────────────────────────────────────
        if (section.type === 'timeline') {
          if (!section.timeline_items?.length) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="relative space-y-5 pl-6">
                <div className="absolute bottom-1 left-2 top-1 w-px bg-border-light" />
                {section.timeline_items.map((item, j) => (
                  <div key={j} className="relative">
                    <div className="absolute -left-4 top-1 h-3 w-3 rounded-full border-2 border-amber-500 bg-surface-primary" />
                    <p className="text-xs text-text-tertiary">{item.date}</p>
                    <p className="text-sm font-semibold text-text-primary">{item.event}</p>
                    {item.description && (
                      <p className="mt-0.5 text-xs text-text-secondary">{item.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        }

        // ── progress ───────────────────────────────────────────────────────────
        if (section.type === 'progress') {
          if (!section.progress_items?.length) return null;
          return (
            <div key={i} className="rounded-2xl border border-border-light bg-surface-primary p-5">
              <SectionTitle title={section.title} />
              <div className="space-y-2">
                {section.progress_items.map((item, j) => {
                  const s = PROGRESS_STATUS[item.status] ?? PROGRESS_STATUS.pending;
                  return (
                    <div key={j} className="flex items-center gap-3 rounded-lg border border-border-light px-4 py-2.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.bg} ${s.text}`}>
                        {s.icon}
                      </span>
                      <span className="flex-1 text-sm text-text-primary">{item.label}</span>
                      {item.details && <span className="text-xs text-text-secondary">{item.details}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export function PendingPromptView({ raw }: { raw: string }) {
  let parsed: Record<string, unknown> | null = null;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p as Record<string, unknown>;
  } catch { /* raw string */ }

  if (!parsed) {
    return <p className="text-sm text-text-primary whitespace-pre-wrap">{raw}</p>;
  }

  return (
    <div className="space-y-3">
      {Object.entries(parsed).map(([key, value]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return (
          <div key={key}>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
            {Array.isArray(value) ? (
              <ul className="mt-1 space-y-1">
                {(value as unknown[]).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" />
                    {String(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-sm text-text-primary">{String(value ?? '—')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StepOutputView({ step, output }: { step: WorkflowStep; output: unknown }) {
  const data = output as Record<string, unknown>;

  if (step.type === 'scrub') {
    const entities = (data?.entities ?? []) as Array<{ token: string; label: string; display_value: string }>;
    return (
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Masked Entities · {entities.length}
        </p>
        {entities.length === 0 ? (
          <p className="text-sm text-text-secondary">No entities masked.</p>
        ) : (
          <div className="divide-y divide-border-light rounded-xl border border-border-light">
            {entities.map((e, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <code className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                  {e.token}
                </code>
                <span className="text-xs text-text-secondary">{e.label}</span>
                <span className="ml-auto text-sm text-text-primary">{e.display_value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step.type === 'file_extract') {
    const text = String(data?.text ?? data?.content ?? '');
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Extracted Text · {text.length.toLocaleString()} chars
        </p>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-light bg-surface-primary p-4 text-xs text-text-primary">
          {text || '—'}
        </pre>
      </div>
    );
  }

  if (step.type === 'llm') {
    if (typeof output === 'string') {
      return <p className="whitespace-pre-wrap text-sm text-text-primary">{output}</p>;
    }
    const text = data?.result ?? data?.text ?? data?.output ?? data?.content;
    if (typeof text === 'string') {
      return <p className="whitespace-pre-wrap text-sm text-text-primary">{text}</p>;
    }
    const entries = Object.entries(data ?? {});
    return (
      <dl className="space-y-4">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-medium capitalize text-text-secondary">{k.replace(/_/g, ' ')}</dt>
            <dd className="mt-0.5">
              {Array.isArray(v) ? (
                <ul className="mt-1 space-y-1">
                  {(v as unknown[]).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" />
                      {String(item)}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-text-primary">{String(v ?? '—')}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const entries = Object.entries(data ?? {});
  if (!entries.length) return <p className="text-sm text-text-secondary">No output recorded.</p>;
  return (
    <dl className="space-y-4">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium capitalize text-text-secondary">{k.replace(/_/g, ' ')}</dt>
          <dd className="mt-0.5">
            {Array.isArray(v) ? (
              <ul className="mt-1 space-y-1">
                {(v as unknown[]).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" />
                    {String(item)}
                  </li>
                ))}
              </ul>
            ) : typeof v === 'object' && v !== null ? (
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-text-secondary">
                {JSON.stringify(v, null, 2)}
              </pre>
            ) : (
              <span className="text-sm text-text-primary">{String(v ?? '—')}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ResultFallback({ outputs }: { outputs: Record<string, unknown> }) {
  const entries = Object.entries(outputs).filter(([k]) => k !== '_completed_steps');
  if (!entries.length) return null;
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return (
          <div key={key} className="rounded-2xl border border-border-light bg-surface-primary p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
            {typeof value === 'string' ? (
              <p className="text-sm text-text-primary whitespace-pre-wrap">{value}</p>
            ) : Array.isArray(value) ? (
              <ul className="space-y-1">
                {(value as unknown[]).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-secondary" />
                    {String(item)}
                  </li>
                ))}
              </ul>
            ) : typeof value === 'object' && value !== null ? (
              <div className="space-y-3">
                {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-text-tertiary">{k.replace(/_/g, ' ')}</p>
                    <p className="mt-0.5 text-sm text-text-primary">
                      {typeof v === 'string' ? v : JSON.stringify(v)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-primary">{String(value)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
