/**
 * Step dependency resolution for gate-scoped workflow copilot context.
 * Regexes ported from aivion-workflow/workflow/compiler.py.
 */

const EXPRESSION_RE = /\$\{([^{}]+)\}/g;
const STEP_OUTPUT_RE = /^steps\.([A-Za-z0-9_-]+)\.output(?=\.|$)/;
const STEP_PARAMS_RE = /^steps\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function normalizeStepId(stepId) {
  if (!stepId || typeof stepId !== 'string') return null;
  if (stepId.endsWith('_ref')) return stepId.slice(0, -4);
  return stepId;
}

function collectExpressions(value, out = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(EXPRESSION_RE)) {
      out.add(match[1]);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExpressions(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectExpressions(v, out);
  }
  return out;
}

function expressionToStepId(expression) {
  const outputMatch = expression.match(STEP_OUTPUT_RE);
  if (outputMatch) return outputMatch[1];
  const paramsMatch = expression.match(STEP_PARAMS_RE);
  if (paramsMatch) return paramsMatch[1];
  return null;
}

function collectStepRefsFromSpec(spec) {
  /** @type {Map<string, Set<string>>} */
  const deps = new Map();
  const steps = spec?.steps ?? [];
  for (const step of steps) {
    const stepId = step?.id;
    if (!stepId) continue;
    const upstream = new Set();
    const expressions = new Set();
    collectExpressions(step.input, expressions);
    collectExpressions(step.input_schema, expressions);
    collectExpressions(step.inputs, expressions);
    collectExpressions(step.prompt, expressions);
    for (const expr of expressions) {
      const refId = expressionToStepId(expr);
      if (refId && refId !== stepId) upstream.add(refId);
    }
    deps.set(stepId, upstream);
  }
  return deps;
}

function transitiveAncestors(deps, stepId) {
  /** @type {Set<string>} */
  const visited = new Set();
  const queue = [...(deps.get(stepId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of deps.get(current) ?? []) {
      if (!visited.has(parent)) queue.push(parent);
    }
  }
  return visited;
}

/**
 * Resolve which steps are in scope at the current human gate.
 * @returns {{
 *   gateStepId: string | null,
 *   upstreamStepIds: string[],
 *   inScopeCompletedIds: string[],
 *   downstreamStepIds: string[],
 * }}
 */
function resolveGateScope(workflow, runSnapshot) {
  const spec = workflow?.spec ?? {};
  const steps = spec.steps ?? [];
  const stepIds = steps.map((s) => s.id).filter(Boolean);
  const pendingRaw =
    runSnapshot?.pending_step_id ?? runSnapshot?.outputs?.pending_step_id ?? null;
  const gateStepId = normalizeStepId(pendingRaw);

  const deps = collectStepRefsFromSpec(spec);
  /** @type {Set<string>} */
  const upstream = gateStepId ? transitiveAncestors(deps, gateStepId) : new Set();

  if (gateStepId) {
    const gateIndex = stepIds.indexOf(gateStepId);
    if (gateIndex > 0) {
      for (let i = 0; i < gateIndex; i += 1) {
        upstream.add(stepIds[i]);
      }
    }
  }

  const completed = Object.keys(runSnapshot?.outputs?._completed_steps ?? {});
  const inScopeCompletedIds = completed.filter((id) => upstream.has(id));

  const downstreamStepIds = stepIds.filter(
    (id) => id !== gateStepId && !upstream.has(id) && !inScopeCompletedIds.includes(id),
  );

  return {
    gateStepId,
    upstreamStepIds: [...upstream],
    inScopeCompletedIds,
    downstreamStepIds,
  };
}

module.exports = {
  normalizeStepId,
  collectStepRefsFromSpec,
  resolveGateScope,
  expressionToStepId,
};
