import type { WorkflowInputField, WorkflowSpec } from './types';

/** compiler_version 2+: per-step parameter gates in chat; no top-level start form. */
export function isInteractiveWorkflowSpec(spec?: WorkflowSpec | null): boolean {
  if (!spec) return false;
  const version = Number(spec.compiler_version ?? 1);
  return version >= 2;
}

/** All per-step input fields (v2), or top-level inputs (v1). */
export function collectWorkflowInputFields(spec?: WorkflowSpec | null): WorkflowInputField[] {
  if (!spec) return [];
  if (isInteractiveWorkflowSpec(spec)) {
    const steps = spec.steps ?? [];
    return steps.flatMap((step) => step.inputs ?? []);
  }
  return spec.inputs ?? [];
}
