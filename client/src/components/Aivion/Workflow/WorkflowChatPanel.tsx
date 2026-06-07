/* eslint-disable i18next/no-literal-string, no-nested-ternary */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import { cn } from '~/utils';
import type {
  StepParametersSchema,
  Workflow,
  WorkflowGatePrefill,
  WorkflowInputField,
  WorkflowRun,
  WorkflowStep,
} from './types';
import WorkflowRunConfirmationCard from './WorkflowRunConfirmationCard';
import WorkflowChatHumanGate from './WorkflowChatHumanGate';
import WorkflowFailedRecovery from './WorkflowFailedRecovery';
import WorkflowChatRunProgress from './WorkflowChatRunProgress';
import WorkflowPipelineVertical from './WorkflowPipelineVertical';
import { RunArticles, extractRunArticleBundle } from './workflows/editorial-publication';
import AssistActionChips from './AssistActionChips';
import type { WorkflowAssistAction } from './assist-action-types';
import { postWorkflowAssist } from './workflow-chat-api';
import WorkflowStepChips from './WorkflowStepChips';
import { useWorkflowChatRun } from './useWorkflowChatRun';
import {
  buildDefaultInputValues,
  extractUrlsFromText,
  isStartRunIntent,
  mergeChatIntoInputs,
  parseInputsForApi,
} from './workflow-input-utils';
import { isSupportedChatGate, parseGateHintsFromChat } from './workflow-gate-hints';
import { buildStepDurationMsMap, completedStepMap, formatWorkflowFailureMilestone } from './helpers';
import {
  getLastRunInputValues,
  hasLastRunPreset,
  persistLastRunInputs,
} from './workflow-input-presets';
import { getWorkflowChatStarters } from './workflow-starters';
import { cancelWorkflowRun } from './workflow-cancel';
import {
  collectWorkflowInputFields,
  isInteractiveWorkflowSpec,
} from './workflow-spec-utils';

type WorkflowCard = WorkflowSummary & { pendingCount?: number };
type Msg =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      variant?:
        | 'workflows'
        | 'workflow-context'
        | 'run-confirmation'
        | 'run-milestone'
        | 'assist-actions';
      actions?: WorkflowAssistAction[];
      workflows?: WorkflowCard[];
      workflow?: WorkflowSummary | null;
      steps?: string[];
      confirmationId?: string;
      values?: Record<string, string>;
      expanded?: boolean;
    };
type WorkflowSummary = {
  id: string;
  name: string;
  icon?: string;
  category?: string;
  description?: string;
  is_runnable?: boolean;
  spec?: {
    steps?: WorkflowStep[];
    inputs?: WorkflowInputField[];
  };
};
type RunSummary = {
  id: string;
  workflow_id: string;
  status: string;
  inputs?: Record<string, unknown>;
  created_at?: string;
};

function AgentIcon() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
      WA
    </span>
  );
}

const DEFAULT_STARTERS = [
  'Summarise the results',
  'What are the key findings?',
  'What should I do next?',
];

function isWorkflowListRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === '/my-workflow' || normalized === '/my-workflows') return true;
  if (normalized.startsWith('/my-workflow ')) return true;
  return /\b(show|list|open|see)\b.*\bmy\b.*\bworkflows?\b/i.test(normalized);
}

function getWorkflowStepSummary(workflow: WorkflowSummary | null): string[] {
  const steps = workflow?.spec?.steps ?? [];
  return steps
    .map((step) => {
      const label =
        typeof step.label === 'string' && step.label.trim()
          ? step.label.trim()
          : typeof step.name === 'string' && step.name.trim()
            ? step.name.trim()
            : typeof step.type === 'string' && step.type.trim()
              ? step.type.trim()
              : typeof step.id === 'string' && step.id.trim()
                ? step.id.trim()
                : '';
      return label;
    })
    .filter((label, index, arr) => label && arr.indexOf(label) === index)
    .slice(0, 5);
}

interface Props {
  starters?: string[];
  mode?: 'panel' | 'page';
}

export default function WorkflowChatPanel({ starters = DEFAULT_STARTERS, mode = 'panel' }: Props) {
  const { token } = useAuthContext();
  const navigate = useNavigate();
  const { id: workflowId, runId } = useParams<{ id?: string; runId?: string }>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [startingRun, setStartingRun] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const announcedStepsRef = useRef<Set<string>>(new Set());
  const stepEndedAtRef = useRef<Map<string, number>>(new Map());
  const runStartedAtRef = useRef<number | null>(null);
  const [gatePrefill, setGatePrefill] = useState<WorkflowGatePrefill | undefined>();
  const [gatePrefillToken, setGatePrefillToken] = useState(0);
  const [parameterPrefill, setParameterPrefill] = useState<Record<string, string> | undefined>();
  const [parameterPrefillToken, setParameterPrefillToken] = useState(0);
  const [fullWorkflow, setFullWorkflow] = useState<Workflow | null>(null);
  const [startFormValues, setStartFormValues] = useState<Record<string, string>>({});
  const [startFormExpanded, setStartFormExpanded] = useState(false);
  const prevRunStatusRef = useRef<string | null>(null);
  const lastParamTargetRef = useRef<string | null>(null);

  const { run: activeRun, onResumed: onRunResumed, refreshRun } = useWorkflowChatRun(
    runId,
    token,
  );
  const [cancellingRun, setCancellingRun] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);

  useEffect(() => {
    setMsgs([]);
    setError(null);
    setLoading(false);
    setStartingRun(false);
    setStartError(null);
    announcedStepsRef.current = new Set();
    stepEndedAtRef.current = new Map();
    runStartedAtRef.current = null;
    setGatePrefill(undefined);
    setGatePrefillToken(0);
    setGateBusy(false);
  }, [runId, workflowId]);

  useEffect(() => {
    if (!workflowId || !token) {
      setFullWorkflow(null);
      return;
    }
    fetch(`/api/aivion/workflow/workflows/${workflowId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((wf: Workflow | null) => setFullWorkflow(wf))
      .catch(() => setFullWorkflow(null));
  }, [workflowId, token]);

  const appendRunMilestone = useCallback((content: string) => {
    setMsgs((prev) => {
      if (prev.some((m) => m.role === 'assistant' && m.variant === 'run-milestone' && m.content === content)) {
        return prev;
      }
      return [...prev, { role: 'assistant', content, variant: 'run-milestone' }];
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetch('/api/aivion/workflow/workflows', {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
      fetch('/api/aivion/workflow/runs?limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([wfs, rs]) => {
        setWorkflows(Array.isArray(wfs) ? wfs : []);
        setRuns(Array.isArray(rs) ? rs : []);
      })
      .catch(() => {
        setWorkflows([]);
        setRuns([]);
      });
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, loading, activeRun?.status, gatePrefillToken]);

  const workflowStats = useMemo(() => {
    const pendingByWorkflow = new Map<string, number>();
    for (const run of runs) {
      if (run.status === 'awaiting_user') {
        pendingByWorkflow.set(run.workflow_id, (pendingByWorkflow.get(run.workflow_id) ?? 0) + 1);
      }
    }
    return workflows
      .map((wf) => ({
        ...wf,
        pendingCount: pendingByWorkflow.get(wf.id) ?? 0,
      }))
      .sort((a, b) => {
        const pendingDelta = (b.pendingCount ?? 0) - (a.pendingCount ?? 0);
        if (pendingDelta !== 0) return pendingDelta;
        return a.name.localeCompare(b.name);
      });
  }, [runs, workflows]);

  const selectedWorkflow = useMemo(() => {
    if (!workflowId) return null;
    return workflowStats.find((wf) => wf.id === workflowId) ?? null;
  }, [workflowId, workflowStats]);

  const selectedWorkflowSteps = useMemo(
    () => getWorkflowStepSummary(selectedWorkflow),
    [selectedWorkflow],
  );

  const workflowSpec = useMemo(
    () => fullWorkflow?.spec ?? selectedWorkflow?.spec ?? null,
    [fullWorkflow, selectedWorkflow],
  );

  const isV2Workflow = useMemo(() => isInteractiveWorkflowSpec(workflowSpec), [workflowSpec]);

  const inputFields = useMemo(
    () => collectWorkflowInputFields(workflowSpec),
    [workflowSpec],
  );

  /** Top-level start form only (v1). v2 workflows collect step inputs at per-step gates. */
  const startFormFields = useMemo(() => {
    if (isV2Workflow || !workflowSpec) return [];
    return workflowSpec.inputs ?? [];
  }, [isV2Workflow, workflowSpec]);

  const workflowSteps = useMemo(
    () => selectedWorkflow?.spec?.steps ?? fullWorkflow?.spec?.steps ?? [],
    [selectedWorkflow, fullWorkflow],
  );

  const pendingReviewRuns = useMemo(() => {
    if (!workflowId) return [];
    return runs.filter((r) => r.workflow_id === workflowId && r.status === 'awaiting_user');
  }, [runs, workflowId]);

  useEffect(() => {
    if (!runId || !activeRun) return;
    const runStart = activeRun.started_at ?? activeRun.created_at;
    if (runStart && runStartedAtRef.current == null) {
      const t = new Date(runStart).getTime();
      if (!Number.isNaN(t)) runStartedAtRef.current = t;
    }
    const done = completedStepMap(activeRun);
    const now = Date.now();
    for (const step of workflowSteps) {
      if (!step.id || !done[step.id]) continue;
      if (!stepEndedAtRef.current.has(step.id)) {
        stepEndedAtRef.current.set(step.id, now);
      }
      if (announcedStepsRef.current.has(`done-${step.id}`)) continue;
      announcedStepsRef.current.add(`done-${step.id}`);
      const label = step.label ?? step.id.replace(/_/g, ' ');
      appendRunMilestone(`Step complete: ${label}`);
    }
    const targetStepId =
      activeRun.pending_target_step_id ??
      (activeRun.pending_input_schema?.type === 'step_parameters'
        ? (activeRun.pending_input_schema as StepParametersSchema).target_step_id
        : null);

    if (activeRun.status === 'awaiting_user' && activeRun.pending_step_id) {
      const gateType = activeRun.pending_input_schema?.type;
      const key = `awaiting-${activeRun.pending_step_id}`;
      if (!announcedStepsRef.current.has(key)) {
        announcedStepsRef.current.add(key);
        const label =
          workflowSteps.find((s) => s.id === targetStepId)?.label ??
          targetStepId?.replace(/_/g, ' ') ??
          activeRun.pending_step_id.replace(/_/g, ' ').replace(/\s*ref$/i, '');
        if (gateType === 'step_parameters') {
          lastParamTargetRef.current = targetStepId ?? null;
          appendRunMilestone(
            `Configure ${label}: review settings below and click Run (or Update settings first).`,
          );
        } else {
          appendRunMilestone(
            `Your review is needed: ${label}. Use the review card below or describe your choices in chat, then click Submit.`,
          );
        }
      }
    }

    const prevStatus = prevRunStatusRef.current;
    if (
      prevStatus === 'awaiting_user' &&
      activeRun.status === 'running' &&
      lastParamTargetRef.current
    ) {
      const key = `running-${lastParamTargetRef.current}`;
      if (!announcedStepsRef.current.has(key)) {
        announcedStepsRef.current.add(key);
        const label =
          workflowSteps.find((s) => s.id === lastParamTargetRef.current)?.label ??
          lastParamTargetRef.current.replace(/_/g, ' ');
        appendRunMilestone(`${label} is running…`);
      }
      lastParamTargetRef.current = null;
    }
    prevRunStatusRef.current = activeRun.status;
    if (activeRun.status === 'completed') {
      const key = 'completed';
      if (!announcedStepsRef.current.has(key)) {
        announcedStepsRef.current.add(key);
        appendRunMilestone('Workflow run completed.');
      }
    }
    if (activeRun.status === 'failed') {
      const key = 'failed';
      if (!announcedStepsRef.current.has(key)) {
        announcedStepsRef.current.add(key);
        appendRunMilestone(formatWorkflowFailureMilestone(activeRun.error_message));
      }
    }
  }, [activeRun, runId, workflowSteps, appendRunMilestone]);

  const handleRunResumed = useCallback(() => {
    onRunResumed();
    setGatePrefill(undefined);
    setParameterPrefill(undefined);
    if (!token) return;
    fetch('/api/aivion/workflow/runs?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rs) => setRuns(Array.isArray(rs) ? rs : []))
      .catch(() => undefined);
  }, [onRunResumed, token]);

  const upsertRunConfirmation = useCallback(
    (values: Record<string, string>, opts?: { expanded?: boolean; note?: string }) => {
      setStartError(null);
      setMsgs((prev) => {
        const rest = prev.filter(
          (m) => !(m.role === 'assistant' && m.variant === 'run-confirmation'),
        );
        return [
          ...rest,
          {
            role: 'assistant',
            content:
              opts?.note ??
              'Review the run settings below. Paste feed URLs in chat to update them, then click Start.',
            variant: 'run-confirmation',
            confirmationId: 'active',
            values,
            expanded: opts?.expanded ?? false,
          },
        ];
      });
    },
    [],
  );

  const updateRunConfirmationValues = useCallback(
    (values: Record<string, string>, expanded?: boolean) => {
      setMsgs((prev) =>
        prev.map((m) => {
          if (m.role !== 'assistant' || m.variant !== 'run-confirmation') return m;
          return {
            ...m,
            values,
            ...(expanded != null ? { expanded } : {}),
          };
        }),
      );
    },
    [],
  );

  const dismissRunConfirmation = useCallback(() => {
    setStartError(null);
    setMsgs((prev) =>
      prev.filter((m) => !(m.role === 'assistant' && m.variant === 'run-confirmation')),
    );
  }, []);

  const lastRunPreset = useMemo(() => {
    if (!workflowId || inputFields.length === 0) return null;
    return getLastRunInputValues(workflowId, inputFields, runs);
  }, [workflowId, inputFields, runs]);

  const lastRunPresetAvailable = useMemo(() => {
    if (!workflowId) return false;
    return hasLastRunPreset(workflowId, inputFields, runs);
  }, [workflowId, inputFields, runs]);

  useEffect(() => {
    if (!workflowId || runId || startFormFields.length === 0) return;
    const base = buildDefaultInputValues(startFormFields);
    const preset = getLastRunInputValues(workflowId, startFormFields, runs);
    setStartFormValues({ ...base, ...(preset ?? {}) });
    setStartFormExpanded(false);
    setStartError(null);
  }, [workflowId, runId, startFormFields, runs]);

  const openRunConfirmation = useCallback(
    (opts?: {
      expanded?: boolean;
      note?: string;
      seedValues?: Record<string, string>;
      useLastRun?: boolean;
    }) => {
      if (!workflowId || !selectedWorkflow) return;
      const base = buildDefaultInputValues(inputFields);
      const preset = opts?.useLastRun !== false ? lastRunPreset : null;
      const values = { ...base, ...(preset ?? {}), ...(opts?.seedValues ?? {}) };
      const note =
        opts?.note ??
        (preset && opts?.useLastRun !== false
          ? 'Pre-filled from your last run. Review settings, then click Start.'
          : undefined);
      upsertRunConfirmation(values, { ...opts, note });
    },
    [workflowId, selectedWorkflow, inputFields, lastRunPreset, upsertRunConfirmation],
  );

  const handleStartRun = useCallback(
    async (values: Record<string, string>) => {
      if (!token || !workflowId || startingRun) return;
      setStartingRun(true);
      setStartError(null);
      try {
        const res = await fetch('/api/aivion/workflow/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            workflow_id: workflowId,
            inputs: parseInputsForApi(inputFields, values),
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            typeof err.error === 'string' ? err.error : `Failed to start (${res.status})`,
          );
        }
        const data = (await res.json()) as { run_id: string };
        persistLastRunInputs(workflowId, values);
        dismissRunConfirmation();
        navigate(`/workflow-chat/${workflowId}/runs/${data.run_id}`);
      } catch (e) {
        setStartError((e as Error).message);
      } finally {
        setStartingRun(false);
      }
    },
    [token, workflowId, startingRun, inputFields, dismissRunConfirmation, navigate],
  );

  const handleStartWorkflowDirect = useCallback(async () => {
    if (!token || !workflowId || startingRun) return;
    setStartingRun(true);
    setStartError(null);
    try {
      const res = await fetch('/api/aivion/workflow/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          workflow_id: workflowId,
          inputs: {},
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          typeof err.error === 'string' ? err.error : `Failed to start (${res.status})`,
        );
      }
      const data = (await res.json()) as { run_id: string };
      navigate(`/workflow-chat/${workflowId}/runs/${data.run_id}`);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStartingRun(false);
    }
  }, [token, workflowId, startingRun, navigate]);

  const applyChatToRunInputs = useCallback(
    (text: string, opts?: { showConfirmation?: boolean; expanded?: boolean }) => {
      if (!workflowId || runId || inputFields.length === 0) {
        return { values: buildDefaultInputValues(inputFields), changed: false };
      }

      const existing =
        [...msgs]
          .reverse()
          .find((m) => m.role === 'assistant' && m.variant === 'run-confirmation')?.values ??
        buildDefaultInputValues(inputFields);

      const { values, changed } = mergeChatIntoInputs(text, inputFields, existing);
      const shouldShow =
        opts?.showConfirmation ||
        isStartRunIntent(text) ||
        changed ||
        extractUrlsFromText(text).length > 0;

      if (shouldShow) {
        upsertRunConfirmation(values, {
          expanded: opts?.expanded,
          note: isStartRunIntent(text)
            ? 'Ready to start — review settings and click Start when you are set.'
            : changed
              ? 'Updated run settings from your message. Click Start when ready.'
              : undefined,
        });
      }

      return { values, changed };
    },
    [workflowId, runId, inputFields, msgs, upsertRunConfirmation],
  );

  useEffect(() => {
    if (!workflowId || runId) return;
    if (!selectedWorkflow) return;

    setMsgs((prev) => {
      if (prev.length > 0 && prev[0].role === 'assistant' && prev[0].variant === 'workflow-context') {
        const first = prev[0];
        if (first.workflow?.id === selectedWorkflow.id) return prev;
      }

      return [
        {
          role: 'assistant',
          content: '',
          variant: 'workflow-context',
          workflow: selectedWorkflow,
          steps: selectedWorkflowSteps,
        },
      ];
    });
  }, [selectedWorkflow, selectedWorkflowSteps, workflowId, runId]);

  const describeRequiredInputs = useCallback(() => {
    const required = inputFields.filter((f) => f.required);
    const optional = inputFields.filter((f) => !f.required);
    const lines: string[] = [];
    if (required.length > 0) {
      lines.push(
        'Required inputs:',
        ...required.map((f) => `• ${f.label}${f.placeholder ? ` — ${f.placeholder}` : ''}`),
      );
    }
    if (optional.length > 0) {
      lines.push(
        '',
        'Optional inputs (defaults apply if omitted):',
        ...optional.slice(0, 6).map((f) => `• ${f.label}`),
        ...(optional.length > 6 ? [`• +${optional.length - 6} more`] : []),
      );
    }
    if (isV2Workflow) {
      lines.length = 0;
      const stepsWithInputs = (workflowSpec?.steps ?? []).filter(
        (s) => (s.inputs?.length ?? 0) > 0,
      );
      if (stepsWithInputs.length === 0) {
        lines.push('This workflow configures itself step by step — click Start workflow.');
      } else {
        lines.push(
          'This workflow asks for settings before each step (not all at once):',
          ...stepsWithInputs.map((s) => {
            const req = (s.inputs ?? []).filter((f) => f.required).map((f) => f.label);
            const suffix = req.length > 0 ? ` (required: ${req.join(', ')})` : '';
            return `• ${s.label ?? s.id}${suffix}`;
          }),
          '',
          'Click Start workflow — the first step gate appears when the pipeline needs your input.',
        );
      }
      return lines.join('\n');
    }
    if (lines.length === 0) {
      lines.push('This workflow has no per-run inputs — click Start when you are ready.');
    } else {
      lines.push('', 'Paste values in chat or click Start a run to configure them.');
    }
    return lines.join('\n');
  }, [inputFields, isV2Workflow, workflowSpec]);

  const handleQuickAction = useCallback(
    (text: string) => {
      if (text === 'Start a run' || text === 'Start workflow') {
        if (isV2Workflow) {
          void handleStartWorkflowDirect();
        } else {
          openRunConfirmation({ note: 'Configure this run, then click Start.' });
        }
        return;
      }
      if (text === 'Run with last settings') {
        openRunConfirmation({
          useLastRun: true,
          note: 'Pre-filled from your last run. Review settings, then click Start.',
        });
        return;
      }
      if (text === 'What inputs do I need?' || text === 'What happens on each step?') {
        setMsgs((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: describeRequiredInputs() },
        ]);
        return;
      }
      if (text === 'Show pending reviews') {
        if (pendingReviewRuns.length === 0) {
          setMsgs((prev) => [
            ...prev,
            { role: 'user', content: text },
            {
              role: 'assistant',
              content: 'No runs are waiting for your review on this workflow.',
            },
          ]);
          return;
        }
        const first = pendingReviewRuns[0];
        navigate(`/workflow-chat/${workflowId}/runs/${first.id}`);
        return;
      }
      setInput(text);
      textareaRef.current?.focus();
    },
    [
      openRunConfirmation,
      describeRequiredInputs,
      pendingReviewRuns,
      navigate,
      workflowId,
      isV2Workflow,
      handleStartWorkflowDirect,
    ],
  );

  const copilotEnabled = Boolean(
    runId && workflowId && activeRun?.status === 'awaiting_user',
  );

  const copilotPlaceholder = gateBusy
    ? 'Regenerating draft…'
    : copilotEnabled
      ? 'Ask about this review gate… (⌘↵ to send)'
      : runId
        ? 'Copilot unlocks when this run needs your review'
        : 'Start a run to unlock gate copilot';

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (
      text === 'Start a run' ||
      text === 'Start workflow' ||
      text === 'Run with last settings' ||
      text === 'What inputs do I need?' ||
      text === 'What happens on each step?' ||
      text === 'Show pending reviews'
    ) {
      setInput('');
      handleQuickAction(text);
      return;
    }

    if (workflowId && !runId && !isV2Workflow) {
      applyChatToRunInputs(text);
    }

    if (runId && activeRun?.status === 'awaiting_user' && activeRun.pending_input_schema) {
      const schemaType = activeRun.pending_input_schema.type;
      if (schemaType === 'step_parameters') {
        const schema = activeRun.pending_input_schema as StepParametersSchema;
        const base = buildDefaultInputValues(schema.fields);
        for (const field of schema.fields) {
          const raw = activeRun.inputs?.[field.name];
          if (raw != null && String(raw).length > 0) {
            base[field.name] = String(raw);
          }
        }
        const { values, changed } = mergeChatIntoInputs(text, schema.fields, base);
        if (changed || extractUrlsFromText(text).length > 0) {
          setParameterPrefill(values);
          setParameterPrefillToken((t) => t + 1);
        }
      }
      if (schemaType === 'record_selection' || schemaType === 'article_review') {
        const hints = parseGateHintsFromChat(text, schemaType);
        if (hints) {
          setGatePrefill(hints);
          setGatePrefillToken((t) => t + 1);
        }
      }
    }

    if (isWorkflowListRequest(text)) {
      setMsgs((prev) => [
        ...prev,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content: 'Here are the workflows available to your account.',
          variant: 'workflows',
          workflows: workflowStats.slice(0, 4),
        },
      ]);
      setInput('');
      textareaRef.current?.focus();
      return;
    }

    if (!copilotEnabled || !workflowId || !runId || !token) {
      setError('Workflow copilot is only available while a run is waiting for your review.');
      return;
    }

    const history = msgs
      .filter((m): m is Extract<Msg, { role: 'user' | 'assistant' }> => {
        if (m.role !== 'user' && m.role !== 'assistant') return false;
        if (m.role === 'assistant' && m.variant) return false;
        return Boolean(m.content.trim());
      })
      .map((m) => ({ role: m.role, content: m.content }));

    setMsgs((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setError(null);
    setMsgs((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const { reply, actions } = await postWorkflowAssist({
        token,
        workflowId,
        runId,
        messages: [...history, { role: 'user', content: text }],
      });
      setMsgs((prev) => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: reply,
          variant: actions.length > 0 ? 'assist-actions' : undefined,
          actions: actions.length > 0 ? actions : undefined,
        },
      ]);
    } catch (e) {
      setMsgs((prev) => (prev[prev.length - 1]?.content === '' ? prev.slice(0, -1) : prev));
      setError((e as Error).message);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [
    input,
    loading,
    token,
    runId,
    workflowId,
    copilotEnabled,
    msgs,
    applyChatToRunInputs,
    handleQuickAction,
    activeRun,
    isV2Workflow,
  ]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  const isEmpty = msgs.length === 0 && !runId;
  const showRunStarters = msgs.length === 0 && Boolean(runId || workflowId);
  const hasRunArticles =
    Boolean(runId && activeRun?.status === 'completed' && extractRunArticleBundle(activeRun));
  const isCompletedRun = activeRun?.status === 'completed';
  const liveStepDurationsMs = useMemo(() => {
    if (!activeRun) return undefined;
    const persisted = buildStepDurationMsMap(activeRun, workflowSteps);
    const live: Record<string, number> = {};
    let prev = runStartedAtRef.current;
    for (const step of workflowSteps) {
      if (!step.id) continue;
      const ended = stepEndedAtRef.current.get(step.id);
      if (ended != null && prev != null) {
        live[step.id] = ended - prev;
        prev = ended;
      } else if (ended != null) {
        prev = ended;
      }
    }
    return { ...live, ...persisted };
  }, [activeRun, workflowSteps]);
  const visibleMsgs = useMemo(() => {
    let list = runId ? msgs.filter((m) => m.variant !== 'workflow-context') : msgs;
    if (isCompletedRun) {
      list = list.filter((m) => m.variant !== 'run-milestone');
    }
    return list;
  }, [msgs, runId, isCompletedRun]);

  const activeStarters = useMemo(() => {
    if (!workflowId && !runId) return starters;
    const wf = fullWorkflow ?? selectedWorkflow;
    return getWorkflowChatStarters({
      workflow: wf,
      runId,
      run: activeRun,
      hasLastRunPreset: lastRunPresetAvailable,
    });
  }, [
    starters,
    workflowId,
    runId,
    fullWorkflow,
    selectedWorkflow,
    activeRun,
    lastRunPresetAvailable,
  ]);

  const isPageMode = mode === 'page';
  const useWorkflowPageLayout = isPageMode && Boolean(workflowId);
  const showVerticalPipeline =
    useWorkflowPageLayout && workflowSteps.length > 0 && Boolean(fullWorkflow ?? selectedWorkflow);
  const pipelineRun: WorkflowRun = useMemo(
    () =>
      activeRun ?? {
        run_id: runId ?? '',
        workflow_id: workflowId ?? '',
        status: 'pending',
        inputs: {},
        outputs: null,
      },
    [activeRun, runId, workflowId],
  );
  const showStartRunPage = useWorkflowPageLayout && !runId;
  const showAssistantHeader = !useWorkflowPageLayout;
  /** Full-page workflow routes: one scroll (sidebar + content). In-run gates keep split scroll. */
  const useUnifiedScroll = Boolean(
    showVerticalPipeline && (isCompletedRun || showStartRunPage),
  );
  const shellClassName = isPageMode
    ? cn(
        'flex h-full min-h-0 w-full',
        showVerticalPipeline ? 'flex-row' : 'flex-col',
        useUnifiedScroll ? 'overflow-y-auto' : 'overflow-hidden',
      )
    : 'flex h-full w-72 shrink-0 flex-col border-l border-border-light bg-surface-primary-alt';

  const workflowCardShellClassName = isPageMode
    ? 'bg-surface-secondary/70 w-full max-w-6xl rounded-3xl border border-border-light p-5 text-left shadow-sm'
    : 'bg-surface-secondary/70 w-full max-w-[18rem] rounded-2xl border border-border-light p-3 text-left shadow-sm';

  const workflowGridClassName = isPageMode
    ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : 'flex max-h-56 flex-col gap-2 overflow-y-auto pr-1';

  const workflowCardHref = (wfId: string) =>
    isPageMode ? `/workflow-chat/${wfId}` : `/workflow/${wfId}`;

  const canCancelRun =
    Boolean(runId && activeRun && token) &&
    (activeRun?.status === 'running' || activeRun?.status === 'awaiting_user');

  const handleCancelRun = useCallback(async () => {
    if (!runId || !token || cancellingRun) return;
    setCancellingRun(true);
    try {
      await cancelWorkflowRun(runId, token);
      await refreshRun();
      appendRunMilestone('Workflow run cancelled.');
    } catch (error) {
      appendRunMilestone(
        error instanceof Error ? error.message : 'Failed to cancel workflow run.',
      );
    } finally {
      setCancellingRun(false);
    }
  }, [runId, token, cancellingRun, refreshRun, appendRunMilestone]);

  const chatColumn = (
    <>
      {showAssistantHeader && (
        <div
          className={
            isPageMode
              ? 'flex items-center gap-2 border-b border-border-light px-6 py-4'
              : 'flex items-center gap-2 border-b border-border-light px-4 py-3'
          }
        >
          <AgentIcon />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-text-primary">
              Workflow Assistant
            </p>
            <p className="truncate text-[10px] text-text-secondary">
              {runId && activeRun
                ? `Run ${runId.slice(0, 8)}… · ${activeRun.status.replace(/_/g, ' ')}${
                    copilotEnabled ? ' · gate copilot' : ''
                  }`
                : runId
                  ? 'Scoped to this run'
                  : 'Workflow actions and gate copilot'}
            </p>
          </div>
          {canCancelRun && (
            <button
              type="button"
              onClick={() => void handleCancelRun()}
              disabled={cancellingRun}
              className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
            >
              {cancellingRun ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>
      )}

      {/* Main content */}
      <div
        className={cn(
          useWorkflowPageLayout ? 'min-w-0 flex-1 p-6 lg:p-10' : isPageMode ? 'flex-1 p-6' : 'flex-1 p-3',
          showStartRunPage && startFormFields.length === 0 && 'flex flex-col',
          !useUnifiedScroll && 'overflow-y-auto',
        )}
      >
        {useWorkflowPageLayout && runId && canCancelRun && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleCancelRun()}
              disabled={cancellingRun}
              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            >
              {cancellingRun ? 'Cancelling…' : 'Cancel run'}
            </button>
          </div>
        )}

        {showStartRunPage && (fullWorkflow ?? selectedWorkflow) && (
          <div
            className={cn(
              startFormFields.length > 0
                ? 'max-w-xl'
                : 'flex min-h-[min(70vh,100%)] flex-1 flex-col items-center justify-center',
            )}
          >
            {startFormFields.length > 0 ? (
              <>
                <h2 className="text-base font-semibold text-text-primary">Start a new run</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Fill in the details below, then click Start.
                </p>
                <div className="mt-6">
                  <WorkflowRunConfirmationCard
                    workflowName={(fullWorkflow ?? selectedWorkflow)?.name ?? 'Workflow'}
                    fields={startFormFields}
                    values={startFormValues}
                    expanded={startFormExpanded}
                    starting={startingRun}
                    startError={startError}
                    token={token}
                    onValuesChange={(values) => setStartFormValues(values)}
                    onExpandedChange={setStartFormExpanded}
                    onStart={() => void handleStartRun(startFormValues)}
                    onCancel={() => {
                      setStartFormValues(buildDefaultInputValues(startFormFields));
                      setStartError(null);
                    }}
                    showUseLastRun={lastRunPresetAvailable}
                    onUseLastRun={() => {
                      if (!lastRunPreset) return;
                      setStartFormValues({
                        ...buildDefaultInputValues(startFormFields),
                        ...lastRunPreset,
                      });
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex w-full max-w-lg flex-col items-center text-center">
                <h2 className="text-base font-semibold text-text-primary">Start a new run</h2>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleStartWorkflowDirect()}
                    disabled={
                      startingRun || (fullWorkflow ?? selectedWorkflow)?.is_runnable === false
                    }
                    className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {startingRun ? 'Starting…' : 'Start Run'}
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-xl border border-border-light bg-surface-primary px-5 py-2.5 text-sm font-semibold text-text-secondary opacity-60"
                  >
                    Auto Run
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-xl border border-border-light bg-surface-primary px-5 py-2.5 text-sm font-semibold text-text-secondary opacity-60"
                  >
                    Scheduling
                  </button>
                </div>
                <div className="mt-6 space-y-1 text-left text-sm text-text-secondary">
                  <p>
                    <span className="font-medium text-text-primary">Start Run:</span> Run with
                    Review Gate
                  </p>
                  <p>
                    <span className="font-medium text-text-primary">Auto Run:</span> Run without
                    review gate
                  </p>
                  <p>
                    <span className="font-medium text-text-primary">Scheduling:</span> Schedule the
                  </p>
                </div>
                {startError && <p className="mt-4 text-sm text-red-600">{startError}</p>}
              </div>
            )}
          </div>
        )}

        {runId && activeRun && !showVerticalPipeline && (
          <div className="mb-4 rounded-xl border border-border-light bg-surface-secondary/80 px-4 py-3">
            <WorkflowChatRunProgress
              run={activeRun}
              steps={workflowSteps}
              compact={!showVerticalPipeline}
            />
            {!showVerticalPipeline && (
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`/workflow/${workflowId}/runs/${runId}`}
                  className="text-[11px] font-medium text-amber-600 hover:underline"
                >
                  Open full run view →
                </a>
              </div>
            )}
          </div>
        )}

        {!showStartRunPage && hasRunArticles && activeRun && (
          <div
            className={cn(
              'mb-4 rounded-xl border border-border-light bg-surface-primary p-4',
              !useUnifiedScroll && 'max-h-[min(60vh,32rem)] overflow-y-auto',
            )}
          >
            <RunArticles run={activeRun} compact />
          </div>
        )}

        {!showStartRunPage && showRunStarters && (
          <div className="mb-4 w-full max-w-md rounded-lg border border-border-light bg-surface-secondary p-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
              Try asking
            </p>
            <div className="flex flex-col gap-1">
              {activeStarters.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleQuickAction(s)}
                  className="rounded px-2 py-1 text-left text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {workflowId && !runId && pendingReviewRuns.length > 0 && (
          <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 dark:border-purple-800/50 dark:bg-purple-950/20">
            <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">
              {pendingReviewRuns.length} run{pendingReviewRuns.length === 1 ? '' : 's'} need
              your review
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pendingReviewRuns.slice(0, 3).map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => navigate(`/workflow-chat/${workflowId}/runs/${run.id}`)}
                  className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
                >
                  Open review
                </button>
              ))}
            </div>
          </div>
        )}

        {!showStartRunPage && isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <AgentIcon />
            <div>
              <p className="text-sm font-medium text-text-primary">Workflow Assistant</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                {runId
                  ? "Ask about this run's results or take an action."
                  : 'Start from one of your available workflows or ask about next steps.'}
              </p>
            </div>
            {!runId && workflowStats.length > 0 && (
              <div className={workflowCardShellClassName}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                      Your workflows
                    </p>
                    <p className="text-xs text-text-secondary">
                      Open one to view its runs and review queue.
                    </p>
                  </div>
                </div>
                <div className={workflowGridClassName}>
                  {workflowStats.map((wf) => (
                    <button
                      key={wf.id}
                      type="button"
                      onClick={() => navigate(workflowCardHref(wf.id))}
                      className={cn(
                        'group rounded-xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md',
                        wf.is_runnable === false
                          ? 'border-amber-200/80 bg-amber-50/70 hover:border-amber-300 dark:border-amber-800/50 dark:bg-amber-950/20'
                          : 'border-border-light bg-surface-primary hover:border-amber-300/70',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm" aria-hidden>
                              {wf.icon ?? '⚡'}
                            </span>
                            <span className="truncate text-sm font-semibold text-text-primary">
                              {wf.name}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
                            {wf.description ?? 'Workflow available to your account.'}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {wf.pendingCount > 0 && (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                              {wf.pendingCount} pending
                            </span>
                          )}
                          {wf.is_runnable === false && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              connect
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(runId || workflowId) && (
              <div className="w-full rounded-lg border border-border-light bg-surface-secondary p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                  Try asking
                </p>
                <div className="flex flex-col gap-1">
                  {activeStarters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleQuickAction(s)}
                      className="rounded px-2 py-1 text-left text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!showStartRunPage &&
          visibleMsgs.map((m, i) => (
          <div
            key={i}
            className={cn('mb-3 flex gap-2', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
          >
            {m.role === 'assistant' && <AgentIcon />}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'whitespace-pre-wrap rounded-tr-sm bg-blue-600 text-white'
                  : 'rounded-tl-sm bg-surface-secondary text-text-primary',
              )}
            >
              {m.role === 'assistant' && m.variant === 'workflow-context' ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                        Active workflow
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-base leading-none" aria-hidden>
                          {m.workflow?.icon ?? '⚡'}
                        </span>
                        <span className="truncate text-sm font-semibold text-text-primary">
                          {m.workflow?.name ?? 'Workflow'}
                        </span>
                      </div>
                    </div>
                    {m.workflow?.is_runnable === false && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        Connect required
                      </span>
                    )}
                  </div>

                  <p className="text-sm leading-relaxed text-text-secondary">
                    {m.workflow?.description ?? 'Workflow context is loaded for this chat.'}
                  </p>

                  {workflowSteps.length > 0 && (
                    <WorkflowStepChips
                      run={runId ? activeRun : null}
                      steps={workflowSteps}
                      preview={!runId}
                      limit={8}
                    />
                  )}

                  {!runId && m.workflow?.is_runnable !== false && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          isV2Workflow
                            ? void handleStartWorkflowDirect()
                            : openRunConfirmation({ note: 'Configure this run, then click Start.' })
                        }
                        disabled={startingRun}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        {isV2Workflow
                          ? startingRun
                            ? 'Starting…'
                            : 'Start workflow'
                          : 'Start a run'}
                      </button>
                      {startError && (
                        <p className="mt-2 text-xs text-red-600">{startError}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : m.role === 'assistant' && m.variant === 'run-milestone' ? (
                <p className="text-sm leading-relaxed text-text-secondary">{m.content}</p>
              ) : m.role === 'assistant' && m.variant === 'run-confirmation' && m.values ? (
                <div className="space-y-2">
                  {m.content && (
                    <p className="text-sm leading-relaxed text-text-secondary">{m.content}</p>
                  )}
                  <WorkflowRunConfirmationCard
                    workflowName={selectedWorkflow?.name ?? 'Workflow'}
                    fields={inputFields}
                    values={m.values}
                    expanded={m.expanded ?? false}
                    starting={startingRun}
                    startError={startError}
                    token={token}
                    onValuesChange={(values) => updateRunConfirmationValues(values)}
                    onExpandedChange={(expanded) => updateRunConfirmationValues(m.values!, expanded)}
                    onStart={() => void handleStartRun(m.values!)}
                    onCancel={dismissRunConfirmation}
                    showUseLastRun={lastRunPresetAvailable}
                    onUseLastRun={() => {
                      if (!lastRunPreset) return;
                      updateRunConfirmationValues(
                        { ...buildDefaultInputValues(inputFields), ...lastRunPreset },
                        m.expanded,
                      );
                    }}
                  />
                </div>
              ) : m.role === 'assistant' && m.variant === 'workflows' ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-primary">{m.content}</p>
                  <div className="grid gap-2">
                    {(m.workflows ?? []).map((wf) => (
                      <button
                        key={wf.id}
                        type="button"
                        onClick={() => navigate(workflowCardHref(wf.id))}
                        className={cn(
                          'group rounded-xl border px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md',
                          wf.is_runnable === false
                            ? 'border-amber-200/80 bg-amber-50/70 hover:border-amber-300 dark:border-amber-800/50 dark:bg-amber-950/20'
                            : 'border-border-light bg-surface-primary hover:border-amber-300/70',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm" aria-hidden>
                                {wf.icon ?? '⚡'}
                              </span>
                              <span className="truncate text-sm font-semibold text-text-primary">
                                {wf.name}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
                              {wf.description ?? 'Workflow available to your account.'}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {(wf.pendingCount ?? 0) > 0 && (
                              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                {wf.pendingCount} pending
                              </span>
                            )}
                            {wf.is_runnable === false && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                connect
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => navigate(isPageMode ? '/workflow-chat' : '/workflow')}
                      className="text-xs font-medium text-amber-600 hover:underline"
                    >
                      Open workflow workspace →
                    </button>
                  </div>
                </div>
              ) : m.role === 'assistant' && m.variant === 'assist-actions' ? (
                <div className="space-y-1">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                  {m.actions && m.actions.length > 0 && runId && (
                    <AssistActionChips
                      actions={m.actions}
                      run={activeRun}
                      runId={runId}
                      token={token}
                      onResumed={handleRunResumed}
                      onArtifactUpdated={() => {
                        void refreshRun();
                        appendRunMilestone('Draft updated.');
                      }}
                      onError={setError}
                    />
                  )}
                </div>
              ) : m.role === 'assistant' && m.content === '' ? (
                <span className="flex gap-1">
                  {[0, 1, 2].map((j) => (
                    <span
                      key={j}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-secondary"
                      style={{ animationDelay: `${j * 0.15}s` }}
                    />
                  ))}
                </span>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {runId && activeRun?.status === 'failed' && (
          <div className="mb-4">
            <WorkflowFailedRecovery
              runId={runId}
              token={token}
              errorMessage={activeRun.error_message}
              onRecovered={() => {
                announcedStepsRef.current.delete('failed');
                handleRunResumed();
              }}
              compact
            />
          </div>
        )}

        {runId &&
          activeRun?.status === 'awaiting_user' &&
          isSupportedChatGate(activeRun.pending_input_schema) && (
            <div className="mb-4">
              <WorkflowChatHumanGate
                run={activeRun}
                workflow={fullWorkflow}
                runId={runId}
                token={token}
                prefill={gatePrefill}
                prefillToken={gatePrefillToken}
                parameterPrefill={parameterPrefill}
                parameterPrefillToken={parameterPrefillToken}
                onResumed={handleRunResumed}
                onRunUpdated={refreshRun}
                onGateBusyChange={setGateBusy}
              />
            </div>
          )}

        {error && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input — hidden once the run has finished */}
      {!isCompletedRun && !showStartRunPage && (
        <div className="border-t border-border-light p-3">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={copilotPlaceholder}
              disabled={!copilotEnabled || loading || gateBusy}
              className="flex-1 resize-none rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!copilotEnabled || !input.trim() || loading || gateBusy}
              className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-xl bg-amber-500 text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M22 2L11 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M22 2L15 22 11 13 2 9l20-7z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <section className={shellClassName}>
      {showVerticalPipeline && (
        <aside
          className={cn(
            'hidden w-64 shrink-0 border-r border-border-light p-6 lg:block lg:p-8',
            !useUnifiedScroll && 'overflow-y-auto',
          )}
        >
          <Link
            to="/workflow-chat"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="m15 18-6-6 6-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Workflows
          </Link>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <WorkflowPipelineVertical
            run={pipelineRun}
            steps={workflowSteps}
            workflow={fullWorkflow ?? selectedWorkflow}
            liveStepDurationsMs={liveStepDurationsMs}
            showWorkflowMeta
          />
          {runId && (
            <a
              href={`/workflow/${workflowId}/runs/${runId}`}
              className="mt-6 inline-block text-[11px] font-medium text-amber-600 hover:underline"
            >
              Open full run view →
            </a>
          )}
        </aside>
      )}
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col',
          showVerticalPipeline && !useUnifiedScroll && 'overflow-hidden',
        )}
      >
        {chatColumn}
      </div>
    </section>
  );
}
