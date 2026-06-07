/* eslint-disable i18next/no-literal-string */
import { useState } from 'react';
import type { WorkflowInputField } from './types';
import WorkflowInputForm from './WorkflowInputForm';
import {
  buildRunInputSummary,
  getMissingRequiredInputs,
  validateRequiredInputs,
} from './workflow-input-utils';

interface Props {
  workflowName: string;
  fields: WorkflowInputField[];
  values: Record<string, string>;
  expanded: boolean;
  starting: boolean;
  startError: string | null;
  token: string | undefined;
  onValuesChange: (values: Record<string, string>) => void;
  onExpandedChange: (expanded: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  onUseLastRun?: () => void;
  showUseLastRun?: boolean;
}

export default function WorkflowRunConfirmationCard({
  workflowName,
  fields,
  values,
  expanded,
  starting,
  startError,
  token,
  onValuesChange,
  onExpandedChange,
  onStart,
  onCancel,
  onUseLastRun,
  showUseLastRun,
}: Props) {
  const [showValidation, setShowValidation] = useState(false);
  const summary = buildRunInputSummary(fields, values);
  const missingRequired = getMissingRequiredInputs(fields, values);
  const canStart = fields.length > 0 && validateRequiredInputs(fields, values);

  function handleFieldChange(name: string, value: string) {
    onValuesChange({ ...values, [name]: value });
  }

  function handleStart() {
    if (!validateRequiredInputs(fields, values)) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);
    onStart();
  }

  return (
    <div className="space-y-3">
      <div>
        <p
          className={
            canStart
              ? 'text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300'
              : 'text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary'
          }
        >
          {canStart ? 'Ready to start' : 'Setup required'}
        </p>
        <p className="mt-1 text-sm font-medium text-text-primary">{workflowName}</p>
        <p className="mt-1 text-xs text-text-secondary">
          {canStart
            ? 'Review the settings below, then click Start. Chat can update these values before you commit.'
            : 'Add required run inputs via Edit settings or paste them in chat, then click Start.'}
        </p>
      </div>

      {!expanded && (
        <ul className="space-y-1">
          {summary.map((line) => {
            const isMissing = line.startsWith('Still needed:');
            return (
              <li
                key={line}
                className={`flex items-start gap-2 text-xs ${isMissing ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-text-secondary'}`}
              >
                <span
                  className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${isMissing ? 'bg-amber-600' : 'bg-amber-500'}`}
                />
                <span>{line}</span>
              </li>
            );
          })}
        </ul>
      )}

      {expanded && (
        <WorkflowInputForm
          fields={fields}
          values={values}
          onChange={handleFieldChange}
          showValidation={showValidation}
          token={token}
          compact
        />
      )}

      {startError && (
        <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {startError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {showUseLastRun && onUseLastRun && (
          <button
            type="button"
            onClick={onUseLastRun}
            disabled={starting}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
          >
            Use last run
          </button>
        )}
        <button
          type="button"
          onClick={handleStart}
          disabled={starting || !canStart}
          title={
            !canStart && missingRequired.length > 0
              ? `Required: ${missingRequired.map((f) => f.label).join(', ')}`
              : undefined
          }
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? 'Starting…' : 'Start'}
        </button>
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          disabled={starting}
          className="rounded-lg border border-border-light bg-surface-primary px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-50"
        >
          {expanded ? 'Hide settings' : 'Edit settings'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={starting}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
