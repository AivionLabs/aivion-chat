# Aivion Fork Changes — LibreChat

All deviations from upstream LibreChat. Update this file whenever a custom change is made.

---

## New Files (Aivion-only, not in upstream)

### `api/server/routes/aivion/workflow.js`
Workflow proxy routes mounted at `/api/aivion/workflow/*`.
- Proxies to `aivion-workflow` API (port 8004) for workflow list, run start, SSE status stream, resume/cancel.
- Also has `POST /api/aivion/workflow/assist` → aivion-router-gateway `/internal/llm/collect` (billed per user VK).
- Env vars used: `SHERU_WORKFLOW_URL`, `AIVION_ROUTER_BASE_URL`, `INTERNAL_SERVICE_TOKEN`.

### `api/server/routes/aivion/cleanup.js`
Internal Clerk event cleanup endpoint at `/internal/cleanup`.
- Bearer-authenticated with `INTERNAL_SERVICE_TOKEN`.
- Called by `aivion-sso` webhook fanout on Clerk user/org events.

### `client/src/components/Aivion/`
All custom Aivion UI — not part of upstream LibreChat.

| File | Purpose |
|---|---|
| `Workflow/WorkflowList.tsx` | Lists workflows assigned to the user |
| `Workflow/WorkflowDetail.tsx` | Workflow detail + run form |
| `Workflow/WorkflowRun.tsx` | SSE-streamed run status view with human-in-the-loop support |
| `Workflow/WorkflowBrowserPanel.tsx` | Workflow browser panel (left sidebar) |
| `Workflow/WorkflowChatPanel.tsx` | Chat panel alongside workflow run |
| `Workflow/WorkflowSidebar.tsx` | Sidebar for workflow navigation |
| `Workflow/WorkflowRunsSection.tsx` | Run history section (also injected into sidebar) |
| `Connections/ConnectionsPage.tsx` | OAuth service connections page (`/connections`) |

---

## Modified Upstream Files

### `api/server/index.js`
Added two route mounts (lines 224–225):
```js
app.use('/api/aivion/workflow', routes.aivionWorkflow);
app.use('/internal/cleanup', routes.aivionCleanup);
```

### `api/server/routes/index.js`
Added imports and exports for `aivionWorkflow` and `aivionCleanup` routes.

### `client/src/hooks/Nav/useUnifiedSidebarLinks.ts`
Added **Workflows** and **Connections** nav links to the sidebar:
- `/workflow` → `WorkflowRunsSection` component
- `/connections` → `ConnectionsPage`
Imports `WorkflowRunsSection` from `~/components/Aivion/Workflow/WorkflowRunsSection`.

### `client/src/components/Chat/Messages/Content/MessageContent.tsx` — Bug fix (Aivion cost footer)
**Problem:** When the agent makes multiple LLM calls for a single message (e.g. planning + response, or titleConvo leaking), each call goes through aivion-router-gateway which injects a cost footer. Both footers end up in the message text, rendering twice in the bubble.

**Fix:** In `DisplayMessage`'s `useMemo` (line ~103), before passing `text` to `<Markdown>`, strip all but the last footer occurrence:
```tsx
const footerMarker = '\n\n---\n💰 **Cost:**';
const firstIdx = text.indexOf(footerMarker);
const lastIdx = text.lastIndexOf(footerMarker);
const displayText =
  firstIdx !== -1 && firstIdx !== lastIdx
    ? text.slice(0, firstIdx) + text.slice(lastIdx)
    : text;
return <Markdown content={displayText} ... />;
```

### `client/src/hooks/SSE/useStepHandler.ts` — Bug fix (stale content base)
**Problem:** Every second (and subsequent) message showed the previous assistant message's cost footer inside the new message bubble, because `useStepHandler` seeded the new response with `lastMessage` (any previous assistant message) instead of the fresh `initialResponse`.

**Fix (line ~454):** Added `lastMessage.messageId === responseMessageId` guard so only an existing placeholder for the *current* response is reused as base:
```ts
// Before (bug):
const responseMessage =
  lastMessage && !lastMessage.isCreatedByUser
    ? lastMessage
    : (submission?.initialResponse as TMessage);

// After (fix):
const responseMessage =
  lastMessage && !lastMessage.isCreatedByUser && lastMessage.messageId === responseMessageId
    ? lastMessage
    : (submission?.initialResponse as TMessage);
```

---

## Config Files

### `librechat.yaml`
Custom endpoint `Aivion` pointing to `AIVION_ROUTER_BASE_URL`:
- Models: `aivion-quick`, `aivion-mid`, `aivion-pro`, `aivion-auto`, `aivion-search`
- `titleConvo: true`, `titleModel: 'aivion-quick'`
- Custom headers: `x-librechat-user-id`, `x-librechat-user-email`, `x-librechat-conversation-id`
- `dropParams: ['user']`

### `.env`
Key Aivion-specific vars (on top of standard LibreChat vars):
```
SHERU_BACKEND_URL=http://localhost:8001      # aivion-console backend
SHERU_WORKFLOW_URL=http://localhost:8004     # aivion-workflow API
AIVION_ROUTER_BASE_URL=http://localhost:8003/v1
INTERNAL_SERVICE_TOKEN=...
OPENID_ISSUER=https://router-api-dev.aivionlabs.com/v1/chat/oidc
OPENID_CLIENT_ID=aivion-librechat
```
OIDC login is via aivion-router-gateway acting as OIDC provider (not Clerk directly).
