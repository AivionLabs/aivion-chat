import type { WorkflowRun } from './types';

export function completedStepMap(run: WorkflowRun): Record<string, { output: unknown }> {
  return (run.outputs?.['_completed_steps'] ?? {}) as Record<string, { output: unknown }>;
}

export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function resolveTemplate(
  template: string,
  completedSteps: Record<string, { output: unknown }>,
  inputs: Record<string, unknown> = {},
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, path: string) => {
    if (path.startsWith('inputs.')) {
      return String(inputs[path.slice('inputs.'.length)] ?? '');
    }
    if (path.startsWith('steps.')) {
      const parts = path.slice('steps.'.length).split('.');
      let value: unknown = completedSteps;
      for (const part of parts) {
        if (value == null || typeof value !== 'object') return '';
        const m = part.match(/^([^\[]*)\[(\d+)\]$/);
        if (m) {
          const key = m[1];
          const idx = parseInt(m[2], 10);
          if (key) value = (value as Record<string, unknown>)[key];
          if (!Array.isArray(value)) return '';
          value = (value as unknown[])[idx];
        } else {
          value = (value as Record<string, unknown>)[part];
        }
      }
      if (Array.isArray(value)) return JSON.stringify(value);
      return value != null ? String(value) : '';
    }
    const [stepId, ...rest] = path.split('.');
    const out = completedSteps[stepId]?.output;
    return out ? String((out as Record<string, unknown>)[rest.join('.')] ?? '') : '';
  });
}

export function formatMetric(value: string, format?: string): string {
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return value;
  if (format === 'currency') return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (format === 'percent') return `${num}%`;
  if (format === 'number') return num.toLocaleString();
  return value;
}

export function resolveJsonArray(
  tpl: string,
  completedSteps: Record<string, { output: unknown }>,
  inputs: Record<string, unknown>,
): Record<string, unknown>[] {
  const raw = resolveTemplate(tpl, completedSteps, inputs);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  } catch { /* fall through */ }
  return [];
}

export function splitDots(val: string | undefined): string[] {
  if (!val || val === '—') return [];
  return val.replace(/ …$/, '').split(' · ').filter(Boolean);
}

export function getNested(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}
