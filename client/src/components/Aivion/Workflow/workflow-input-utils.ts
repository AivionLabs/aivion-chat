import type { WorkflowInputField } from './types';

export function buildDefaultInputValues(fields: WorkflowInputField[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (field.default != null && String(field.default).length > 0) {
      values[field.name] = String(field.default);
    } else {
      values[field.name] = '';
    }
  }
  return values;
}

export function parseInputsForApi(
  fields: WorkflowInputField[],
  values: Record<string, string>,
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const field of fields) {
    const v = values[field.name] ?? '';
    if (field.type === 'number') {
      parsed[field.name] = v === '' ? null : Number(v);
    } else if (field.type === 'boolean') {
      parsed[field.name] = v === 'true';
    } else if (field.type === 'file_array') {
      try {
        parsed[field.name] = JSON.parse(v);
      } catch {
        parsed[field.name] = [];
      }
    } else {
      parsed[field.name] = v;
    }
  }
  return parsed;
}

function isRequiredInputMissing(field: WorkflowInputField, values: Record<string, string>): boolean {
  if (!field.required) return false;
  const v = values[field.name] ?? '';
  if (field.type === 'file') return !v;
  if (field.type === 'file_array') {
    try {
      return (JSON.parse(v) as string[]).length === 0;
    } catch {
      return true;
    }
  }
  return String(v).trim().length === 0;
}

export function getMissingRequiredInputs(
  fields: WorkflowInputField[],
  values: Record<string, string>,
): WorkflowInputField[] {
  return fields.filter((field) => isRequiredInputMissing(field, values));
}

export function validateRequiredInputs(
  fields: WorkflowInputField[],
  values: Record<string, string>,
): boolean {
  return getMissingRequiredInputs(fields, values).length === 0;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(URL_RE) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[),.;]+$/, '')))];
}

const START_RUN_RE =
  /\b(start|run|launch|kick\s*off|begin)\b.*\b(run|workflow|edition|today|now)?\b|\b(run|start)\s+(today|now|this)\b/i;

export function isStartRunIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized.toLowerCase() === 'start a run') return true;
  return START_RUN_RE.test(normalized);
}

/** Merge chat text into known workflow input fields (client-side heuristics). */
export function mergeChatIntoInputs(
  text: string,
  fields: WorkflowInputField[],
  current: Record<string, string>,
): { values: Record<string, string>; changed: boolean } {
  const next = { ...current };
  let changed = false;

  const urls = extractUrlsFromText(text);
  if (urls.length > 0) {
    const feedField = fields.find((f) => f.name === 'feed_urls' || /feed/i.test(f.name));
    if (feedField) {
      const existing = (next[feedField.name] ?? '')
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const merged = [...new Set([...existing, ...urls])];
      const joined = merged.join('\n');
      if (joined !== next[feedField.name]) {
        next[feedField.name] = joined;
        changed = true;
      }
    }
  }

  return { values: next, changed };
}

export function buildRunInputSummary(
  fields: WorkflowInputField[],
  values: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const missing = getMissingRequiredInputs(fields, values);

  if (missing.length > 0) {
    lines.push(`Still needed: ${missing.map((f) => f.label).join(', ')}`);
  }

  const feedField = fields.find((f) => f.name === 'feed_urls');
  if (feedField) {
    const raw = values[feedField.name] ?? '';
    const count = String(raw)
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
    if (count > 0) {
      lines.push(`${count} feed URL${count === 1 ? '' : 's'}`);
    }
  }

  const customFields = fields.filter((f) => {
    if (f.name === 'feed_urls') return false;
    const v = values[f.name] ?? '';
    const d = f.default != null ? String(f.default) : '';
    return v.trim() && v !== d;
  });

  if (customFields.length > 0) {
    const preview = customFields
      .slice(0, 2)
      .map((f) => {
        const v = values[f.name] ?? '';
        const display = v.length > 32 ? `${v.slice(0, 29)}…` : v;
        return `${f.label}: ${display}`;
      });
    lines.push(...preview);
    if (customFields.length > 2) {
      lines.push(`+${customFields.length - 2} more custom setting${customFields.length - 2 === 1 ? '' : 's'}`);
    }
  }

  if (missing.length === 0) {
    if (lines.length === 0) {
      lines.push('All workflow defaults');
    } else {
      lines.push('Remaining fields use workflow defaults');
    }
  }

  return lines;
}
