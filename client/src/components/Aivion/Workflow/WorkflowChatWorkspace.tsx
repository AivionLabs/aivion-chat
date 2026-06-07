/* eslint-disable i18next/no-literal-string */
import { useParams } from 'react-router-dom';
import WorkflowChatPanel from './WorkflowChatPanel';

export default function WorkflowChatWorkspace() {
  const { id: workflowId } = useParams<{ id?: string }>();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-primary">
      {!workflowId && (
        <div className="shrink-0 border-b border-border-light px-8 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Workflows
          </p>
          <h1 className="mt-1 text-2xl font-bold text-text-primary">My Workflows</h1>
        </div>
      )}

      <div
        className={
          workflowId ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-hidden px-8 py-6'
        }
      >
        <WorkflowChatPanel mode="page" />
      </div>
    </div>
  );
}
