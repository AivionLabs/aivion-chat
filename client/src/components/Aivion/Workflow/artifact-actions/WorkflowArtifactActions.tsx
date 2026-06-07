import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import type { ServiceConnection, WorkflowArtifact } from '../types';

type Props = {
  artifacts: WorkflowArtifact[];
  runId: string;
  stepLabelMap: Record<string, string>;
};

type ActionKey = 'email' | 'drive';

type ActionResult = {
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
};

const ACTIONS: Array<{
  key: ActionKey;
  label: string;
  description: string;
  requires: ServiceConnection['service_key'];
}> = [
  {
    key: 'email',
    label: 'Send by Email',
    description: 'Send this file as a Gmail attachment.',
    requires: 'gmail',
  },
  {
    key: 'drive',
    label: 'Save to Google Drive',
    description: 'Upload this file into your Google Drive.',
    requires: 'google_drive',
  },
];

function defaultEmailSubject(fileName: string): string {
  return `Workflow artifact: ${fileName}`;
}

export default function WorkflowArtifactActions({
  artifacts,
  runId,
  stepLabelMap,
}: Props) {
  const { token } = useAuthContext();
  const [connections, setConnections] = useState<ServiceConnection[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<WorkflowArtifact | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' });
  const [driveForm, setDriveForm] = useState({
    folder_name: 'Aivion Workflow Exports',
    file_name: '',
  });

  useEffect(() => {
    if (!token) return;
    fetch('/api/aivion/workflow/connections', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status}`);
        }
        return response.json();
      })
      .then((data: ServiceConnection[]) => {
        setConnections(data);
        setConnectionsLoaded(true);
      })
      .catch(() => {
        setConnections([]);
        setConnectionsError('Could not load service connections.');
        setConnectionsLoaded(true);
      });
  }, [token]);

  const connectionMap = useMemo(
    () => Object.fromEntries(connections.map((connection) => [connection.service_key, connection])),
    [connections],
  );

  function resetDialogState() {
    setSelectedAction(null);
    setActionError(null);
    setActionResult(null);
    setSubmitting(false);
  }

  function openArtifactActions(artifact: WorkflowArtifact) {
    setSelectedArtifact(artifact);
    setEmailForm({
      to: '',
      subject: defaultEmailSubject(artifact.fileName),
      body: '',
    });
    setDriveForm({
      folder_name: 'Aivion Workflow Exports',
      file_name: artifact.fileName,
    });
    resetDialogState();
  }

  function closeDialog() {
    setSelectedArtifact(null);
    resetDialogState();
  }

  async function submitAction() {
    if (!token || !selectedArtifact || !selectedAction) return;

    const payload =
      selectedAction === 'email'
        ? emailForm
        : driveForm;

    setSubmitting(true);
    setActionError(null);
    setActionResult(null);

    try {
      const response = await fetch(
        `/api/aivion/workflow/runs/${runId}/artifacts/${selectedArtifact.stepId}/actions/${selectedAction}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
      }

      if (selectedAction === 'email') {
        const result = (data as { result?: { to?: string; subject?: string } }).result;
        setActionResult({
          title: 'Email sent',
          description: result?.to
            ? `Sent to ${result.to}${result.subject ? ` with subject "${result.subject}"` : ''}.`
            : 'The artifact was sent as an email attachment.',
        });
      } else {
        const result = (data as { result?: { web_view_link?: string; folder_name?: string } }).result;
        setActionResult({
          title: 'Saved to Google Drive',
          description: result?.folder_name
            ? `Uploaded into the "${result.folder_name}" folder.`
            : 'The artifact was uploaded to Google Drive.',
          href: result?.web_view_link,
          hrefLabel: 'Open in Drive',
        });
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function renderActionForm() {
    if (!selectedArtifact || !selectedAction) return null;

    if (selectedAction === 'email') {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary">
            Attachment: <span className="font-medium text-text-primary">{selectedArtifact.fileName}</span>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
              To
            </span>
            <input
              type="email"
              value={emailForm.to}
              onChange={(e) => setEmailForm((prev) => ({ ...prev, to: e.target.value }))}
              className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
              placeholder="recipient@example.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Subject
            </span>
            <input
              type="text"
              value={emailForm.subject}
              onChange={(e) => setEmailForm((prev) => ({ ...prev, subject: e.target.value }))}
              className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
              placeholder="Workflow artifact"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Body
            </span>
            <textarea
              rows={5}
              value={emailForm.body}
              onChange={(e) => setEmailForm((prev) => ({ ...prev, body: e.target.value }))}
              className="w-full resize-y rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
              placeholder="Add a short message"
            />
          </label>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-secondary">
          File: <span className="font-medium text-text-primary">{selectedArtifact.fileName}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Drive Folder
          </span>
          <input
            type="text"
            value={driveForm.folder_name}
            onChange={(e) => setDriveForm((prev) => ({ ...prev, folder_name: e.target.value }))}
            className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
            placeholder="Aivion Workflow Exports"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-secondary">
            File Name
          </span>
          <input
            type="text"
            value={driveForm.file_name}
            onChange={(e) => setDriveForm((prev) => ({ ...prev, file_name: e.target.value }))}
            className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-amber-400"
          />
        </label>
      </div>
    );
  }

  if (artifacts.length === 0) return null;

  return (
    <>
      <div className="rounded-xl border border-border-light bg-surface-primary p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Downloaded files
        </p>
        <div className="space-y-3">
          {artifacts.map((artifact) => (
            <div
              key={artifact.stepId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border-light bg-surface-secondary px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{artifact.fileName}</p>
                <p className="text-xs text-text-tertiary">
                  {stepLabelMap[artifact.stepId] ?? artifact.stepId}
                  {artifact.contentType ? ` · ${artifact.contentType}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={artifact.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-border-light px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:border-amber-300 hover:text-amber-700"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => openArtifactActions(artifact)}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
                >
                  Take action
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl border border-border-light bg-surface-primary shadow-2xl">
            <div className="flex items-start justify-between border-b border-border-light px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Artifact actions
                </p>
                <h2 className="mt-1 text-lg font-bold text-text-primary">{selectedArtifact.fileName}</h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-md px-2 py-1 text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
              >
                Close
              </button>
            </div>

            <div className="space-y-5 px-5 py-5">
              {!selectedAction && (
                <>
                  <p className="text-sm text-text-secondary">
                    Choose what you want to do with this artifact.
                  </p>
                  <div className="space-y-3">
                    {ACTIONS.map((action) => {
                      const connection = connectionMap[action.requires];
                      const connected = Boolean(connection?.connected);
                      return (
                        <div
                          key={action.key}
                          className="rounded-xl border border-border-light bg-surface-secondary px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-text-primary">{action.label}</p>
                              <p className="mt-1 text-xs text-text-secondary">{action.description}</p>
                              <p className="mt-1 text-xs text-text-tertiary">
                                {connected
                                  ? `Connected via ${connection?.account_email ?? action.requires}`
                                  : `${action.requires.replace('_', ' ')} is not connected`}
                              </p>
                            </div>
                            {connected ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAction(action.key);
                                  setActionError(null);
                                  setActionResult(null);
                                }}
                                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
                              >
                                Select
                              </button>
                            ) : (
                              <Link
                                to="/connections"
                                className="rounded-lg border border-border-light px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:border-amber-300 hover:text-amber-700"
                              >
                                Connect
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {connectionsError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                      {connectionsError}
                    </div>
                  )}
                  {!connectionsLoaded && (
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Loading connections…
                    </div>
                  )}
                </>
              )}

              {selectedAction && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAction(null);
                      setActionError(null);
                      setActionResult(null);
                    }}
                    className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                  >
                    ← Back to actions
                  </button>
                  <div>
                    <h3 className="text-base font-semibold text-text-primary">
                      {ACTIONS.find((action) => action.key === selectedAction)?.label}
                    </h3>
                    <p className="mt-1 text-sm text-text-secondary">
                      {ACTIONS.find((action) => action.key === selectedAction)?.description}
                    </p>
                  </div>

                  {renderActionForm()}

                  {actionError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                      {actionError}
                    </div>
                  )}

                  {actionResult && (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-800 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-300">
                      <p className="font-semibold">{actionResult.title}</p>
                      {actionResult.description && <p className="mt-1">{actionResult.description}</p>}
                      {actionResult.href && (
                        <a
                          href={actionResult.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex text-sm font-medium text-green-800 underline dark:text-green-300"
                        >
                          {actionResult.hrefLabel ?? 'Open'}
                        </a>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="rounded-lg border border-border-light px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-text-secondary hover:text-text-primary"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitAction()}
                      disabled={submitting}
                      className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
                    >
                      {submitting ? 'Working…' : selectedAction === 'email' ? 'Send email' : 'Save to Drive'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
