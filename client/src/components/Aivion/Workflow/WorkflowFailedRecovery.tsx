/* eslint-disable i18next/no-literal-string */
import { useState } from 'react';
import { isRssEmptyTermination } from './helpers';
import { recoverWorkflowRun, type RecoverMode } from './workflow-recover';

interface Props {
  runId: string;
  token: string | undefined;
  errorMessage?: string | null;
  onRecovered: (message: string) => void;
  compact?: boolean;
}

export default function WorkflowFailedRecovery({
  runId,
  token,
  errorMessage,
  onRecovered,
  compact,
}: Props) {
  const [recovering, setRecovering] = useState<RecoverMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  async function handleRecover(mode: RecoverMode) {
    if (!token) return;
    setRecovering(mode);
    setError(null);
    try {
      const result = await recoverWorkflowRun(runId, mode, token);
      setLastMessage(result.message);
      onRecovered(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery failed.');
    } finally {
      setRecovering(null);
    }
  }

  return (
    <div
      className={
        compact
          ? 'space-y-3 rounded-xl border border-red-200/80 bg-red-50/50 p-4 dark:border-red-900/40 dark:bg-red-950/20'
          : 'space-y-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20'
      }
    >
      <p
        className={
          isRssEmptyTermination(errorMessage)
            ? 'text-sm text-amber-800 dark:text-amber-300'
            : 'text-sm text-red-700 dark:text-red-400'
        }
      >
        {errorMessage ?? 'The workflow run failed.'}
      </p>
      {isRssEmptyTermination(errorMessage) && (
        <p className="text-xs text-text-secondary">
          The RSS feed returned no articles (for example, an empty weekend arXiv feed). Start a
          new run with a different feed or try again when the feed has new items.
        </p>
      )}
      {lastMessage && (
        <p className="text-xs text-text-secondary">{lastMessage}</p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!token || recovering !== null}
          onClick={() => void handleRecover('failed_step')}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recovering === 'failed_step' ? 'Recovering…' : 'Retry from failed step'}
        </button>
        <button
          type="button"
          disabled={!token || recovering !== null}
          onClick={() => void handleRecover('restart')}
          className="rounded-lg border border-border-light bg-surface-primary px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recovering === 'restart' ? 'Starting…' : 'Start again'}
        </button>
      </div>
    </div>
  );
}
