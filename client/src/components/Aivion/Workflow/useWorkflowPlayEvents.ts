import { useEffect, useState } from 'react';
import type { WorkflowPlayEvent } from './completed-run-timeline';

export function useWorkflowPlayEvents(
  runId: string | undefined,
  token: string | undefined,
  enabled: boolean,
): WorkflowPlayEvent[] {
  const [events, setEvents] = useState<WorkflowPlayEvent[]>([]);

  useEffect(() => {
    if (!enabled || !runId || !token) {
      setEvents([]);
      return;
    }

    let cancelled = false;

    fetch(`/api/aivion/workflow/runs/${runId}/play-events`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) return { events: [] as WorkflowPlayEvent[] };
        return (await response.json()) as { events?: WorkflowPlayEvent[] };
      })
      .then((data) => {
        if (!cancelled) {
          setEvents(Array.isArray(data.events) ? data.events : []);
        }
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, runId, token]);

  return events;
}
