const express = require('express');
const { generateCheckAccess, skipAgentCheck } = require('@librechat/api');
const { PermissionTypes, Permissions, PermissionBits } = require('librechat-data-provider');
const {
  moderateText,
  // validateModel,
  validateConvoAccess,
  buildEndpointOption,
  canAccessAgentFromBody,
} = require('~/server/middleware');
const { initializeClient } = require('~/server/services/Endpoints/agents');
const AgentController = require('~/server/controllers/agents/request');
const addTitle = require('~/server/services/Endpoints/agents/title');
const { getRoleByName } = require('~/models');
const { loadWorkflowPrompt } = require('~/server/utils/workflowPrompt');

const router = express.Router();

const checkAgentAccess = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE],
  skipCheck: skipAgentCheck,
  getRoleByName,
});
const checkAgentResourceAccess = canAccessAgentFromBody({
  requiredPermission: PermissionBits.VIEW,
});

router.use(moderateText);
router.use(checkAgentAccess);
router.use(checkAgentResourceAccess);
router.use(validateConvoAccess);
router.use(buildEndpointOption);

const ALLOWED_WORKFLOW_MODELS = ['aivion-free', 'aivion-quick', 'aivion-mid', 'aivion-pro'];

// Workflow-specific context injection.
// If the request carries a workflow_id, resolve a short context note for the
// workflow page and attach it to req so the agent initializer can append it as
// additional_instructions.
// workflow_model (optional) overrides the agent's default model for this request.
router.use(async (req, _res, next) => {
  const workflowId = req.body?.workflow_id;
  if (workflowId) {
    const userId = req.user?.openidId || req.user?.id;
    req.workflowInstructions = await loadWorkflowPrompt(workflowId, {
      userId,
      runId: req.body?.run_id || undefined,
    });
  }
  const workflowModel = req.body?.workflow_model;
  if (workflowModel && ALLOWED_WORKFLOW_MODELS.includes(workflowModel)) {
    req.workflowModel = workflowModel;
  }
  next();
});

const controller = async (req, res, next) => {
  await AgentController(req, res, next, initializeClient, addTitle);
};

/**
 * @route POST / (regular endpoint)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/', controller);

/**
 * @route POST /:endpoint (ephemeral agents)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/:endpoint', controller);

module.exports = router;
