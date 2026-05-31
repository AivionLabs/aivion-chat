import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuthContext } from '~/hooks/AuthContext';
import { cn } from '~/utils';

const WORKFLOW_AGENT_ID = 'agent_aOm_0GJj1WKvThsNxOSEb';

type Msg = { role: 'user' | 'assistant'; content: string };

function AgentIcon() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold">
      WA
    </span>
  );
}

const DEFAULT_STARTERS = ['Summarise the results', 'What are the key findings?', 'What should I do next?'];

const MODELS = [
  { value: 'aivion-free', label: 'Free' },
  { value: 'aivion-quick', label: 'Quick' },
  { value: 'aivion-mid', label: 'Mid' },
  { value: 'aivion-pro', label: 'Pro' },
] as const;

type ModelValue = (typeof MODELS)[number]['value'];

interface Props {
  starters?: string[];
}

export default function WorkflowChatPanel({ starters = DEFAULT_STARTERS }: Props) {
  const { token } = useAuthContext();
  const { id: workflowId, runId } = useParams<{ id?: string; runId?: string }>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolActive, setToolActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelValue>('aivion-free');
  const parentMessageIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const runInjectedRef = useRef(false);

  useEffect(() => {
    setMsgs([]);
    setConversationId(null);
    parentMessageIdRef.current = null;
    setError(null);
    runInjectedRef.current = false;
  }, [runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, toolActive]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Inject run ID on first message of a run so the agent calls get_run
    let fullText = text;
    if (runId && !runInjectedRef.current) {
      fullText = `[Workflow run ID: ${runId}]\n\n${text}`;
      runInjectedRef.current = true;
    }

    setMsgs((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setToolActive(false);
    setError(null);

    // Empty placeholder — updated in place as tokens stream in
    setMsgs((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const startRes = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: fullText,
          endpoint: 'agents',
          agent_id: WORKFLOW_AGENT_ID,
          conversationId: conversationId ?? null,
          parentMessageId: parentMessageIdRef.current ?? null,
          workflow_id: workflowId ?? null,
          workflow_model: selectedModel,
        }),
      });

      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `HTTP ${startRes.status}`);
      }

      const { streamId, conversationId: newConvoId } = await startRes.json() as {
        streamId: string;
        conversationId: string;
      };

      if (newConvoId && !conversationId) {
        setConversationId(newConvoId);
      }

      const streamRes = await fetch(
        `/api/agents/chat/stream/${encodeURIComponent(streamId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!streamRes.ok || !streamRes.body) {
        throw new Error('Stream unavailable');
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          if (data.final != null) {
            // responseMessage.text holds the full aggregated response text
            type RespMsg = { messageId?: string; text?: string; content?: Array<{ type: string; text?: string }> };
            const respMsg = data.responseMessage as RespMsg | undefined;
            // Track the last assistant message ID so the next turn chains correctly
            if (respMsg?.messageId) {
              parentMessageIdRef.current = respMsg.messageId;
            }
            const finalText =
              respMsg?.text ||
              (respMsg?.content ?? [])
                .filter((p) => p.type === 'text')
                .map((p) => p.text ?? '')
                .join('') ||
              accumulated;
            if (finalText) {
              setMsgs((prev) => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: finalText },
              ]);
            }
            break streamLoop;
          }

          // on_message_delta: { event: 'on_message_delta', data: { delta: { content: [{type:'text', text:'...'}] } } }
          if (data.event === 'on_message_delta') {
            type DeltaData = { delta?: { content?: Array<{ type: string; text?: string }> } };
            const parts = (data.data as DeltaData | undefined)?.delta?.content ?? [];
            const chunk = parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
            if (chunk) {
              accumulated += chunk;
              setToolActive(false);
              setMsgs((prev) => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: accumulated },
              ]);
            } else {
              setToolActive(true);
            }
          } else if (data.event != null || (data.type != null && data.text == null)) {
            setToolActive(true);
          }
        }
      }

      reader.cancel();
      // If stream closed without a final event and nothing was accumulated, remove the empty bubble
      setMsgs((prev) =>
        prev[prev.length - 1]?.content === '' ? prev.slice(0, -1) : prev,
      );
    } catch (e) {
      setMsgs((prev) =>
        prev[prev.length - 1]?.content === '' ? prev.slice(0, -1) : prev,
      );
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setToolActive(false);
      textareaRef.current?.focus();
    }
  }, [input, loading, token, runId, conversationId, selectedModel]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  const isEmpty = msgs.length === 0;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-border-light bg-surface-primary-alt">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-light px-4 py-3">
        <AgentIcon />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary leading-tight">Workflow Assistant</p>
          <p className="truncate text-[10px] text-text-secondary">
            {runId ? 'Scoped to this run' : 'Workflow Q&A + actions'}
          </p>
        </div>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as ModelValue)}
          className="shrink-0 rounded-lg border border-border-light bg-surface-secondary px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          aria-label="Model"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3">
        {isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <AgentIcon />
            <div>
              <p className="text-sm font-medium text-text-primary">Workflow Assistant</p>
              <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                {runId
                  ? 'Ask about this run\'s results or take an action.'
                  : 'Ask about workflow runs, results, or next steps.'}
              </p>
            </div>
            {runId && (
              <div className="w-full rounded-lg border border-border-light bg-surface-secondary p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">
                  Try asking
                </p>
                <div className="flex flex-col gap-1">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setInput(s);
                        textareaRef.current?.focus();
                      }}
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

        {msgs.map((m, i) => (
          <div
            key={i}
            className={cn('mb-3 flex gap-2', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
          >
            {m.role === 'assistant' && <AgentIcon />}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                m.role === 'user'
                  ? 'rounded-tr-sm bg-blue-600 text-white'
                  : 'rounded-tl-sm bg-surface-secondary text-text-primary',
              )}
            >
              {m.role === 'assistant' && m.content === '' ? (
                toolActive ? (
                  <span className="text-xs text-text-secondary italic">
                    Checking workflow data…
                  </span>
                ) : (
                  <span className="flex gap-1">
                    {[0, 1, 2].map((j) => (
                      <span
                        key={j}
                        className="h-1.5 w-1.5 rounded-full bg-text-secondary animate-bounce"
                        style={{ animationDelay: `${j * 0.15}s` }}
                      />
                    ))}
                  </span>
                )
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border-light p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask AI… (⌘↵ to send)"
            className="flex-1 resize-none rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || loading}
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
    </aside>
  );
}
