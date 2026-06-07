export type CancelRunResult = {
  run_id: string;
  status: string;
};

export async function cancelWorkflowRun(
  runId: string,
  token: string,
): Promise<CancelRunResult> {
  const res = await fetch(`/api/aivion/workflow/runs/${runId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
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
            : `Cancel failed (${res.status})`;
    throw new Error(detail);
  }
  return (await res.json()) as CancelRunResult;
}
