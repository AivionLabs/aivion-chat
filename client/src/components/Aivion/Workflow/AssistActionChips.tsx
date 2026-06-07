/* eslint-disable i18next/no-literal-string */
import { useState } from 'react';
import type { WorkflowAssistAction } from './assist-action-types';
import { validateWorkflowAction } from './assist-action-validation';
import type { WorkflowRun } from './types';
import { buildArticleReviewResumePayload } from './workflows/editorial-publication/article-review-resume';

interface Props {
  actions: WorkflowAssistAction[];
  run: WorkflowRun | null | undefined;
  runId: string;
  token: string | undefined;
  onResumed: () => void;
  onArtifactUpdated?: () => void;
  onError?: (message: string) => void;
}

function chipTone(action: WorkflowAssistAction): string {
  if (action.kind === 'navigate') {
    return 'border-border-light bg-surface-secondary text-text-primary hover:bg-surface-primary';
  }
  if (action.kind === 'artifact_action') {
    return 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200';
  }
  const decision = String(action.payload?.decision ?? '');
  if (decision === 'reject' || decision === 'deny') {
    return 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300';
  }
  if (decision === 'approve' || decision === 'handoff' || decision === 'publish') {
    return 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-300';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200';
}

export default function AssistActionChips({
  actions,
  run,
  runId,
  token,
  onResumed,
  onArtifactUpdated,
  onError,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!actions.length) return null;

  async function handleAction(action: WorkflowAssistAction) {
    const validation = validateWorkflowAction(action, run);
    if (!validation.ok) {
      onError?.(validation.error);
      return;
    }

    if (action.kind === 'navigate') {
      if (action.href) {
        window.location.assign(action.href);
        return;
      }
      document.getElementById('workflow-human-gate')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (!token) return;

    setBusyId(action.id);
    try {
      if (action.kind === 'artifact_action') {
        const stepId = action.stepId ?? (action as { step_id?: string }).step_id;
        const actionName = action.action;
        if (!stepId || !actionName) {
          throw new Error('Invalid artifact action.');
        }

        const response = await fetch(
          `/api/aivion/workflow/runs/${runId}/artifacts/${stepId}/actions/${actionName}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(action.payload ?? {}),
          },
        );

        if (!response.ok) {
          const error = (await response.json().catch(() => ({}))) as {
            detail?: string;
            error?: string;
          };
          throw new Error(error.detail ?? error.error ?? `Request failed (${response.status})`);
        }

        onArtifactUpdated?.();
        return;
      }

      if (action.kind !== 'resume') return;

      const payload = action.payload ?? {};
      const decision = String(payload.decision ?? '');
      const input =
        run?.pending_input_schema?.type === 'article_review'
          ? buildArticleReviewResumePayload({
              decision,
              notes: typeof payload.notes === 'string' ? payload.notes : '',
              revisionNotes:
                typeof payload.revision_notes === 'string' ? payload.revision_notes : undefined,
            })
          : payload;

      const response = await fetch(`/api/aivion/workflow/runs/${runId}/resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
        };
        throw new Error(error.detail ?? error.error ?? `Request failed (${response.status})`);
      }

      onResumed();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={busyId != null}
          onClick={() => void handleAction(action)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${chipTone(action)}`}
        >
          {busyId === action.id ? 'Working…' : action.label}
        </button>
      ))}
    </div>
  );
}
