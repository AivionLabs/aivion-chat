export type RecoverMode = 'failed_step' | 'restart';

export type RecoveryResult = {
  run_id: string;
  status: string;
  recovery_strategy: 'retry' | 'rerun' | 'restart';
  from_step_id: string | null;
  message: string;
};

export async function recoverWorkflowRun(
  runId: string,
  mode: RecoverMode,
  token: string,
): Promise<RecoveryResult> {
  const res = await fetch(`/api/aivion/workflow/runs/${runId}/recover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      detail?: string;
      error?: string | { detail?: string };
    };
    const detail =
      typeof err.detail === 'string'
        ? err.detail
        : typeof err.error === 'string'
          ? err.error
          : typeof err.error === 'object' && err.error && 'detail' in err.error
            ? String((err.error as { detail?: string }).detail)
            : `Recovery failed (${res.status})`;
    throw new Error(detail);
  }
  return (await res.json()) as RecoveryResult;
}
