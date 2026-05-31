import { useCallback, useEffect, useRef } from 'react';

import type { WorkflowRun } from './types';

export function useRunStream(
  runId: string | undefined,
  token: string | undefined,
  streamKey: number,
  onUpdate: (run: WorkflowRun) => void,
  onDone: () => void,
) {
  const abortRef = useRef<AbortController | null>(null);

  const connect = useCallback(async () => {
    if (!runId || !token) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/aivion/workflow/runs/${runId}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) { onDone(); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6)) as WorkflowRun;
              onUpdate(data);
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    } finally {
      onDone();
    }
  }, [runId, token, streamKey, onUpdate, onDone]);

  useEffect(() => {
    void connect();
    return () => abortRef.current?.abort();
  }, [connect]);
}
