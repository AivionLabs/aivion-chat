/**
 * Aivion Workflow proxy — forwards authenticated requests to sheru-platform services.
 * All routes require LibreChat JWT. The user's Clerk ID (stored as openidId by OIDC) is
 * forwarded as X-User-Id so the workflow engine can scope runs to the correct user.
 */
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const {
  loadWorkflowAssistPrompt,
  loadWorkflowContextData,
  resolveAssistModel,
  invalidateWorkflowContextCache,
} = require('~/server/utils/workflowPrompt');
const { buildWorkflowActions } = require('~/server/utils/workflowActions');

const router = express.Router();
router.use(requireJwtAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const BACKEND_URL = process.env.SHERU_BACKEND_URL || 'http://sheru-platform-backend:8001';
const WORKFLOW_URL = process.env.SHERU_WORKFLOW_URL || 'http://sheru-platform-workflow:8004';
const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || 'dev-internal-token-rotate-me';

function getWorkflowUserId(req) {
  const userId = req.user?.openidId || req.user?.id;
  if (!userId) {
    const err = new Error('Workflow access requires a user identity');
    err.statusCode = 401;
    throw err;
  }
  return userId;
}

function serviceHeaders(req) {
  const userId = getWorkflowUserId(req);
  return {
    Authorization: `Bearer ${SERVICE_TOKEN}`,
    'X-User-Id': userId,
    'Content-Type': 'application/json',
  };
}

// GET /api/aivion/workflow/runs → sheru-platform-backend /admin/api/v1/workspace/runs (history list)
router.get('/runs', async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.workflow_id) params.set('workflow_id', req.query.workflow_id);
    if (req.query.limit) params.set('limit', req.query.limit);
    if (req.query.offset) params.set('offset', req.query.offset);
    if (req.query.status) params.set('status', req.query.status);
    const { data } = await axios.get(
      `${BACKEND_URL}/admin/api/v1/workspace/runs?${params}`,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/workflows → sheru-platform-workflow /v1/workflows (includes is_runnable)
router.get('/workflows', async (req, res) => {
  try {
    const { data } = await axios.get(`${WORKFLOW_URL}/v1/workflows`, {
      headers: serviceHeaders(req),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/workflows/:workflowId → sheru-platform-backend /admin/api/v1/workspace/workflows/:workflowId
router.get('/workflows/:workflowId', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${BACKEND_URL}/admin/api/v1/workspace/workflows/${req.params.workflowId}`,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/runs → sheru-platform-workflow /v1/workflow-runs
router.post('/runs', async (req, res) => {
  try {
    const { data } = await axios.post(`${WORKFLOW_URL}/v1/workflow-runs`, req.body, {
      headers: serviceHeaders(req),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/schedules → sheru-platform-workflow /v1/workflow-schedules
router.get('/schedules', async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.workflow_id) params.set('workflow_id', req.query.workflow_id);
    const { data } = await axios.get(
      `${WORKFLOW_URL}/v1/workflow-schedules?${params}`,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/schedules → sheru-platform-workflow /v1/workflow-schedules
router.post('/schedules', async (req, res) => {
  try {
    const { data } = await axios.post(`${WORKFLOW_URL}/v1/workflow-schedules`, req.body, {
      headers: serviceHeaders(req),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/schedules/:scheduleId/runs → sheru-platform-workflow /v1/workflow-schedules/:scheduleId/runs
router.get('/schedules/:scheduleId/runs', async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.limit) params.set('limit', req.query.limit);
    const { data } = await axios.get(
      `${WORKFLOW_URL}/v1/workflow-schedules/${req.params.scheduleId}/runs?${params}`,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/schedules/:scheduleId/pause
router.post('/schedules/:scheduleId/pause', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/workflow-schedules/${req.params.scheduleId}/pause`,
      {},
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/schedules/:scheduleId/resume
router.post('/schedules/:scheduleId/resume', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/workflow-schedules/${req.params.scheduleId}/resume`,
      {},
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/runs/:runId → sheru-platform-workflow /v1/workflow-runs/:runId
router.get('/runs/:runId', async (req, res) => {
  try {
    const { data } = await axios.get(`${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}`, {
      headers: serviceHeaders(req),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/runs/:runId/resume
router.post('/runs/:runId/resume', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/resume`,
      req.body,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/runs/:runId/cancel
router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/cancel`,
      {},
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/runs/:runId/recover
router.post('/runs/:runId/recover', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/recover`,
      req.body ?? {},
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/runs/:runId/play-events → artifact play audit trail
router.get('/runs/:runId/play-events', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/play-events`,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/runs/:runId/steps/:stepId/file → workflow service redirect
router.get('/runs/:runId/steps/:stepId/file', async (req, res) => {
  try {
    const response = await axios.get(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/steps/${req.params.stepId}/file`,
      {
        headers: serviceHeaders(req),
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      },
    );

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      res.status(response.status).set('Location', response.headers.location).end();
      return;
    }

    res.status(response.status).send(response.data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/runs/:runId/artifacts/:stepId/actions/:action
router.post('/runs/:runId/artifacts/:stepId/actions/:action', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/artifacts/${req.params.stepId}/actions/${req.params.action}`,
      req.body,
      { headers: serviceHeaders(req) },
    );

    if (req.params.action === 'regenerate_item') {
      try {
        const { data: run } = await axios.get(
          `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}`,
          { headers: serviceHeaders(req) },
        );
        if (run?.workflow_id) {
          invalidateWorkflowContextCache(run.workflow_id, req.params.runId);
        }
      } catch (_) {
        /* cache invalidation is best-effort */
      }
    }

    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    const detail = err.response?.data?.detail ?? err.response?.data ?? 'upstream error';
    res.status(status).json({ error: detail });
  }
});

// POST /api/aivion/workflow/uploads → sheru-platform-workflow /v1/uploads
router.post('/uploads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
    const { data } = await axios.post(`${WORKFLOW_URL}/v1/uploads`, form, {
      headers: { ...serviceHeaders(req), ...form.getHeaders() },
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/datasets/inspect → sheru-platform-workflow /v1/datasets/inspect
router.post('/datasets/inspect', async (req, res) => {
  try {
    const { data } = await axios.post(`${WORKFLOW_URL}/v1/datasets/inspect`, req.body, {
      headers: serviceHeaders(req),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// GET /api/aivion/workflow/runs/:runId/stream → SSE proxy (piped, long-lived)
router.get('/runs/:runId/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = getWorkflowUserId(req);
  try {
    const upstream = await axios.get(
      `${WORKFLOW_URL}/v1/workflow-runs/${req.params.runId}/stream`,
      {
        headers: {
          Authorization: `Bearer ${SERVICE_TOKEN}`,
          'X-User-Id': userId,
          Accept: 'text/event-stream',
        },
        responseType: 'stream',
        timeout: 0,
      },
    );
    upstream.data.pipe(res);
    req.on('close', () => upstream.data.destroy());
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'upstream error' })}\n\n`);
    res.end();
  }
});

// GET /api/aivion/workflow/connections → sheru-platform-workflow /v1/connections
router.get('/connections', async (req, res) => {
  try {
    const { data } = await axios.get(`${WORKFLOW_URL}/v1/connections`, {
      headers: serviceHeaders(req),
    });
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// POST /api/aivion/workflow/connections/:service/initiate
router.post('/connections/:service/initiate', async (req, res) => {
  try {
    const { data } = await axios.post(
      `${WORKFLOW_URL}/v1/connections/${req.params.service}/initiate`,
      {},
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

// Deprecated — use POST /assist with { workflow_id, run_id, messages }
router.post('/runs/:runId/chat', (_req, res) => {
  res.status(410).json({
    error: 'deprecated',
    message: 'Use POST /api/aivion/workflow/assist with { workflow_id, run_id, messages }',
  });
});

// POST /api/aivion/workflow/assist → gate-scoped copilot via /internal/llm/collect
router.post('/assist', async (req, res) => {
  const rawGateway = process.env.AIVION_ROUTER_BASE_URL || 'http://aivion-router-gateway:8003';
  const GATEWAY_URL = rawGateway.replace(/\/v\d+\/?$/, '');

  try {
    const clerkUserId = getWorkflowUserId(req);
    const { messages = [], workflow_id: workflowId, run_id: runId } = req.body;

    if (!workflowId || !runId) {
      return res.status(400).json({ error: 'missing_scope' });
    }

    const { workflow, runSnapshot: run } = await loadWorkflowContextData(workflowId, {
      userId: clerkUserId,
      runId,
      bypassCache: true,
    });

    if (!run) {
      return res.status(404).json({ error: 'run_not_found' });
    }

    if (run.workflow_id !== workflowId) {
      return res.status(403).json({ error: 'run_workflow_mismatch' });
    }

    if (run.status !== 'awaiting_user') {
      return res.status(409).json({ error: 'chat_unavailable' });
    }

    const system = await loadWorkflowAssistPrompt(workflowId, {
      userId: clerkUserId,
      runId,
      workflow,
      runSnapshot: run,
    });

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    const prompt = history ? `${system}\n\nConversation:\n${history}` : system;

    let orgSlug = null;
    try {
      const { data: me } = await axios.get(`${BACKEND_URL}/admin/api/v1/workspace/me`, {
        headers: serviceHeaders(req),
      });
      orgSlug = me.org_slug ?? null;
    } catch (_) {
      /* fall through — unbilled if org unresolvable */
    }

    const model = resolveAssistModel(workflow, run);

    const { data } = await axios.post(
      `${GATEWAY_URL}/internal/llm/collect`,
      {
        prompt,
        model,
        product: orgSlug || 'sheru',
        team_slug: orgSlug || null,
        clerk_user_id: clerkUserId,
        workflow_run_id: runId,
      },
      {
        headers: {
          Authorization: `Bearer ${SERVICE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const reply = String(data.text ?? '').trim();
    if (!reply) {
      return res.status(502).json({
        error: 'empty_reply',
        message: 'The AI returned an empty response. Try again.',
      });
    }

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    const actions = buildWorkflowActions(run, {
      userMessage: typeof latestUserMessage === 'string' ? latestUserMessage : '',
    });
    res.json({ reply, actions });
  } catch (err) {
    const status = err.statusCode ?? err.response?.status ?? 502;
    const detail =
      err.response?.data?.detail ??
      err.response?.data?.message ??
      err.response?.data?.error ??
      err.message ??
      'AI service unavailable';
    res.status(status).json({ error: detail });
  }
});

// DELETE /api/aivion/workflow/connections/:service
router.delete('/connections/:service', async (req, res) => {
  try {
    const { data } = await axios.delete(
      `${WORKFLOW_URL}/v1/connections/${req.params.service}`,
      { headers: serviceHeaders(req) },
    );
    res.json(data);
  } catch (err) {
    const status = err.response?.status ?? 502;
    res.status(status).json({ error: err.response?.data ?? 'upstream error' });
  }
});

module.exports = router;
