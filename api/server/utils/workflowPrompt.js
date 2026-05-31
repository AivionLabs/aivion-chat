/**
 * Resolves the workflow-type-specific system prompt from Bifrost.
 *
 * Flow:
 *   workflow_id → GET /v1/workflows/{id} on aivion-workflow → slug
 *   slug → "workflow-{slug}" prompt name in Bifrost
 *   Bifrost prompt content → injected as agent.additional_instructions
 *
 * Both the slug and the Bifrost content are cached for CACHE_TTL to avoid
 * per-message API round-trips.
 */

const axios = require('axios');
const { logger } = require('@librechat/data-schemas');

const WORKFLOW_URL = process.env.SHERU_WORKFLOW_URL || 'http://localhost:8004';
const BIFROST_URL = process.env.BIFROST_URL || 'http://localhost:8081';
const SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;

const CACHE_TTL = 5 * 60 * 1000; // 5 min

/** workflow_id → { slug, expiresAt } */
const slugCache = new Map();
/** prompt name → { content, expiresAt } */
const promptCache = new Map();

async function getWorkflowType(workflowId) {
  const hit = slugCache.get(workflowId);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.slug;
  }
  const res = await axios.get(`${WORKFLOW_URL}/v1/workflows/${workflowId}`, {
    headers: {
      Authorization: `Bearer ${SERVICE_TOKEN}`,
      'X-User-Id': 'system',
    },
    timeout: 3000,
  });
  // Prefer category; fall back to slug with trailing version suffix stripped (e.g. cv-screening-2 → cv-screening)
  const type = (res.data.category || res.data.slug).replace(/-\d+$/, '');
  slugCache.set(workflowId, { slug: type, expiresAt: Date.now() + CACHE_TTL });
  return type;
}

async function getBifrostPrompt(slug) {
  const promptName = `workflow-${slug}`;
  const hit = promptCache.get(promptName);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.content;
  }

  const listRes = await axios.get(`${BIFROST_URL}/api/prompt-repo/prompts`, { timeout: 3000 });
  const prompts = listRes.data.prompts ?? [];
  const found = prompts.find((p) => p.name === promptName);
  if (!found) {
    return null;
  }

  // Bifrost list response embeds the latest version with messages — use it directly.
  // Fall back to a separate version fetch if the list omits embedded messages.
  let messages = (found.latest_version?.messages ?? []).map((m) => m.message ?? m);
  if (!messages.length) {
    const versionNum = found.latest_version_number ?? found.latest_version?.version_number ?? 1;
    const verRes = await axios.get(
      `${BIFROST_URL}/api/prompt-repo/prompts/${found.id}/versions/${versionNum}`,
      { timeout: 3000 },
    );
    messages = verRes.data.version?.messages ?? [];
  }
  const system = messages.find((m) => m.role === 'system');
  const content = system?.content ?? null;

  if (content) {
    promptCache.set(promptName, { content, expiresAt: Date.now() + CACHE_TTL });
  }
  return content;
}

/**
 * Returns the workflow-type-specific Bifrost system prompt, or null if
 * no prompt is registered for this workflow type (agent falls back to
 * its base instructions).
 *
 * Never throws — errors are logged and null is returned so the agent
 * still works with its static instructions.
 *
 * @param {string} workflowId
 * @returns {Promise<string|null>}
 */
async function loadWorkflowPrompt(workflowId) {
  try {
    const slug = await getWorkflowType(workflowId);
    return await getBifrostPrompt(slug);
  } catch (err) {
    logger.warn('[workflowPrompt] Failed to load workflow prompt', {
      workflowId,
      error: err.message,
    });
    return null;
  }
}

module.exports = { loadWorkflowPrompt };
