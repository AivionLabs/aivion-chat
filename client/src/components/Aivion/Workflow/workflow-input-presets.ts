import type { WorkflowInputField } from './types';

const STORAGE_PREFIX = 'wf_last_inputs_';

type RunWithInputs = {
  workflow_id: string;
  inputs?: Record<string, unknown>;
  created_at?: string;
};

function storageKey(workflowId: string): string {
  return `${STORAGE_PREFIX}${workflowId}`;
}

/** Convert API run inputs back into form string values. */
export function serializeInputsForForm(
  fields: WorkflowInputField[],
  inputs: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = inputs[field.name];
    if (raw == null) {
      values[field.name] = field.default != null ? String(field.default) : '';
      continue;
    }
    if (field.type === 'file_array') {
      values[field.name] = Array.isArray(raw) ? JSON.stringify(raw) : String(raw);
    } else if (field.type === 'boolean') {
      values[field.name] = raw === true || raw === 'true' ? 'true' : 'false';
    } else {
      values[field.name] = String(raw);
    }
  }
  return values;
}

export function loadStoredLastRunInputs(workflowId: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(storageKey(workflowId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function persistLastRunInputs(workflowId: string, values: Record<string, string>): void {
  try {
    localStorage.setItem(storageKey(workflowId), JSON.stringify(values));
  } catch {
    /* quota / private mode */
  }
}

/** Most recent run for this workflow (API list is created_at desc). */
export function getLastRunInputValues(
  workflowId: string,
  fields: WorkflowInputField[],
  runs: RunWithInputs[],
): Record<string, string> | null {
  const last = runs.find((r) => r.workflow_id === workflowId && r.inputs);
  if (last?.inputs) {
    return serializeInputsForForm(fields, last.inputs);
  }
  return loadStoredLastRunInputs(workflowId);
}

export function hasLastRunPreset(
  workflowId: string,
  fields: WorkflowInputField[],
  runs: RunWithInputs[],
): boolean {
  const preset = getLastRunInputValues(workflowId, fields, runs);
  if (!preset) return false;
  return fields.some((f) => {
    const v = (preset[f.name] ?? '').trim();
    const d = f.default != null ? String(f.default) : '';
    return v.length > 0 && v !== d;
  });
}
