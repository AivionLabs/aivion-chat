import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowRun } from './types';
import { useRunStream } from './useRunStream';

function mergeRunUpdate(prev: WorkflowRun | null, data: WorkflowRun): WorkflowRun {
  if (!prev) return data;
  const merged: WorkflowRun = { ...prev, ...data };
  if (data.outputs == null && prev.outputs != null) merged.outputs = prev.outputs;
  if (data.pending_input_schema == null && prev.pending_input_schema != null) {
    merged.pending_input_schema = prev.pending_input_schema;
  }
  if (data.pending_step_id == null && prev.pending_step_id != null) {
    merged.pending_step_id = prev.pending_step_id;
  }
  if (data.pending_prompt == null && prev.pending_prompt != null) {
    merged.pending_prompt = prev.pending_prompt;
  }
  return merged;
}

export function useWorkflowChatRun(runId: string | undefined, token: string | undefined) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const completionFetchedRef = useRef<string | null>(null);

  const onUpdate = useCallback((data: WorkflowRun) => {
    setRun((prev) => mergeRunUpdate(prev, data));
  }, []);

  const onDone = useCallback(() => undefined, []);

  useRunStream(runId, token, streamKey, onUpdate, onDone);

  const refreshRun = useCallback(async () => {
    if (!runId || !token) return null;
    const res = await fetch(`/api/aivion/workflow/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as WorkflowRun;
    setRun((prev) => mergeRunUpdate(prev, data));
    return data;
  }, [runId, token]);

  const reconnectStream = useCallback(() => {
    setStreamKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!runId || !token) {
      setRun(null);
      return;
    }
    completionFetchedRef.current = null;
    let cancelled = false;
    fetch(`/api/aivion/workflow/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WorkflowRun | null) => {
        if (!cancelled && data) setRun(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId, token]);

  useEffect(() => {
    if (!run || !runId || !token) return;
    if (run.status !== 'completed' && run.status !== 'failed') return;
    const key = `${runId}-${run.status}`;
    if (completionFetchedRef.current === key) return;
    completionFetchedRef.current = key;
    void refreshRun();
  }, [run?.status, runId, token, refreshRun, run]);

  const onResumed = useCallback(() => {
    void refreshRun().then(() => reconnectStream());
  }, [refreshRun, reconnectStream]);

  return { run, refreshRun, reconnectStream, onResumed };
}
