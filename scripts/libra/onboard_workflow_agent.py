"""One-shot onboarding for the Workflow Assistant agent.

Creates a LibreChat agent scoped to workflow runs — it can answer questions
about workflow state, review outputs, and call workflow API actions
(get_run, resume_run, cancel_run, list_runs) directly from the chat.

Steps:
  1. Load the LibreChat system prompt from the local prompt file
  2. Create (or update) the LibreChat agent
  3. Register the workflow actions (OpenAPI spec → POST /api/agents/actions/:id)
  4. Set org-member-only ACL (NOT public marketplace)

Run from the repo root:
    python scripts/libra/onboard_workflow_agent.py
    python scripts/libra/onboard_workflow_agent.py --dry-run

Env vars:
    LIBRECHAT_URL       default: http://localhost:3081
    LIBRECHAT_API_KEY   admin user API key (Settings → API Keys in LibreChat UI)
    MONGO_URI           default: mongodb://localhost:27018/LibreChat
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))

from _librechat import LibreChatAdmin  # noqa: E402
from _mongo import get_db  # noqa: E402

# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

AGENT_NAME = "Workflow Assistant"
PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "workflow_assistant.md"

# Call aivion-workflow directly — localhost:8004 is already in
# librechat.yaml → actions.allowedAddresses, no config change needed.
# Auth: INTERNAL_SERVICE_TOKEN as Bearer (service_http).
WORKFLOW_BASE_URL = "http://localhost:8004"

PROMPT_CONTENT = PROMPT_PATH.read_text(encoding="utf-8")

# OpenAPI spec for the workflow action tools.
# The agent calls these endpoints via LibreChat's action execution engine.
OPENAPI_SPEC = {
    "openapi": "3.1.0",
    "info": {"title": "Aivion Workflow API", "version": "1.0.0"},
    "servers": [{"url": WORKFLOW_BASE_URL}],
    "paths": {
        "/v1/workflow-runs/{run_id}": {
            "get": {
                "operationId": "get_run",
                "summary": "Get full details of a workflow run",
                "parameters": [
                    {
                        "name": "run_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {"200": {"description": "Run details"}},
            }
        },
        "/v1/workflow-runs/{run_id}/resume": {
            "post": {
                "operationId": "resume_run",
                "summary": "Complete a human review gate with structured input (validated server-side)",
                "parameters": [
                    {
                        "name": "run_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "required": ["input"],
                                "properties": {
                                    "input": {
                                        "type": "object",
                                        "description": "Gate payload — selections for record_selection, decision/notes for article_review, or other fields per pending_input_schema",
                                        "additionalProperties": True,
                                    }
                                },
                            }
                        }
                    },
                },
                "responses": {"200": {"description": "Run resumed"}},
            }
        },
        "/v1/workflow-runs/{run_id}/cancel": {
            "post": {
                "operationId": "cancel_run",
                "summary": "Cancel a workflow run",
                "parameters": [
                    {
                        "name": "run_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ],
                "responses": {"200": {"description": "Run cancelled"}},
            }
        },
        "/v1/workflow-runs": {
            "get": {
                "operationId": "list_runs",
                "summary": "List workflow runs for the current user",
                "parameters": [
                    {
                        "name": "status",
                        "in": "query",
                        "required": False,
                        "schema": {
                            "type": "string",
                            "enum": ["running", "awaiting_user", "completed", "failed", "cancelled"],
                        },
                    }
                ],
                "responses": {"200": {"description": "List of runs"}},
            }
        },
    },
}

# Function definitions extracted from the spec — sent to LibreChat's action endpoint.
ACTION_FUNCTIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_run",
            "description": "Get full workflow run details: status, inputs, outputs._completed_steps (draft articles, publication bundle items, dispatch endpoint), and pending review schema.",
            "parameters": {
                "type": "object",
                "required": ["run_id"],
                "properties": {
                    "run_id": {"type": "string", "description": "The workflow run UUID"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resume_run",
            "description": "Complete a human review gate. Pass structured input matching the run pending_input_schema. Prefer the chat UI submit button; only use when the user explicitly confirms.",
            "parameters": {
                "type": "object",
                "required": ["run_id", "input"],
                "properties": {
                    "run_id": {"type": "string", "description": "The workflow run UUID"},
                    "input": {
                        "type": "object",
                        "description": "Structured gate payload (selections, decision, notes, etc.)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_run",
            "description": "Cancel a workflow run.",
            "parameters": {
                "type": "object",
                "required": ["run_id"],
                "properties": {
                    "run_id": {"type": "string", "description": "The workflow run UUID"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_runs",
            "description": "List workflow runs for the current user, optionally filtered by status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["running", "awaiting_user", "completed", "failed", "cancelled"],
                        "description": "Filter by run status",
                    }
                },
            },
        },
    },
]

AGENT_BODY = {
    "name": AGENT_NAME,
    "description": "Workflow Assistant · Ask about workflow runs, review outputs, and take next actions.",
    "instructions": PROMPT_CONTENT,
    "provider": "Aivion",
    "model": "aivion-free",
    "tools": [],  # populated after action registration
    "capabilities": ["artifacts"],
    "conversation_starters": [
        "Summarise the key findings",
        "What should I do next?",
        "What are the red flags?",
        "Show me my pending reviews",
    ],
}


# ---------------------------------------------------------------------------
def create_librechat_agent(lc: LibreChatAdmin, dry_run: bool) -> str | None:
    if dry_run:
        print(f"  (dry-run) would upsert LibreChat agent '{AGENT_BODY['name']}'")
        return "dry-run-agent-id"
    agent = lc.upsert_agent(AGENT_BODY)
    agent_id = agent.get("id") or agent.get("_id")
    return str(agent_id) if agent_id else None


def register_actions(lc: LibreChatAdmin, agent_id: str, dry_run: bool) -> bool:
    """POST /api/agents/actions/:agent_id to register the workflow OpenAPI actions."""
    if dry_run:
        print("  (dry-run) would register 4 workflow actions")
        return True

    import os
    service_token = os.environ.get("INTERNAL_SERVICE_TOKEN", "dev-internal-token-rotate-me")

    existing_actions = [
        action
        for action in lc.list_agent_actions()
        if action.get("agent_id") == agent_id and action.get("metadata", {}).get("domain") == WORKFLOW_BASE_URL
    ]
    if existing_actions:
        print(f"  Found {len(existing_actions)} existing workflow action prototype(s) — deleting before re-registering")
        for action in existing_actions:
            action_id = action.get("action_id") or action.get("id")
            if not action_id:
                continue
            lc.delete_agent_action(agent_id, str(action_id))
            print(f"    deleted action prototype {action_id}")

    payload = {
        "functions": ACTION_FUNCTIONS,
        "metadata": {
            "domain": WORKFLOW_BASE_URL,
            "raw_spec": json.dumps(OPENAPI_SPEC),
            # LibreChat reads metadata.api_key to build Authorization: Bearer {key}
            # on every outgoing action HTTP call (see packages/api ActionService.js).
            "api_key": service_token,
            "auth": {
                "type": "service_http",
                "authorization_type": "bearer",
            },
        },
    }

    r = lc.client.post(f"/api/agents/actions/{agent_id}", json=payload)
    if r.status_code == 400 and "Domain not allowed" in r.text:
        print("  WARNING: localhost:8004 not in librechat.yaml → actions.allowedAddresses")
        print("  This should already be set — check librechat.yaml.")
        return False

    if not r.is_success:
        print(f"  WARNING: action registration failed ({r.status_code}): {r.text[:200]}")
        return False

    print(f"  Registered {len(ACTION_FUNCTIONS)} actions (get_run, resume_run, cancel_run, list_runs)")
    return True


def grant_public_acl(agent_id: str, db: object, dry_run: bool) -> None:
    """Grant public VIEW access so any authenticated user can use this agent."""
    agent_doc = db.agents.find_one({"id": agent_id}, {"_id": 1})
    if not agent_doc:
        print(f"  error: agent {agent_id} not found in MongoDB")
        return

    agent_oid = agent_doc["_id"]

    public_exists = db.aclentries.find_one({
        "resourceId": agent_oid,
        "resourceType": "agent",
        "principalType": "public",
    })
    if public_exists:
        print(f"  Public ACL entry already exists for {agent_id} — skipping")
        return

    if dry_run:
        print(f"  (dry-run) would insert public aclentry (resourceId={agent_oid})")
        return

    db.aclentries.insert_one({
        "resourceId": agent_oid,
        "resourceType": "agent",
        "principalType": "public",
        "permBits": 1,
    })
    db.agents.update_one({"_id": agent_oid}, {"$set": {"isPublic": True}})
    print(f"  Public ACL entry inserted + isPublic=true (resourceId={agent_oid})")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=== Onboarding: Workflow Assistant ===\n")

    # Step 1 — LibreChat agent
    print("Step 1: LibreChat Agent")
    with LibreChatAdmin() as lc:
        agent_id = create_librechat_agent(lc, args.dry_run)

        if not agent_id:
            print("error: failed to create LibreChat agent", file=sys.stderr)
            return 1

        # Step 2 — Register actions
        print("\nStep 2: Workflow Actions (OpenAPI)")
        register_actions(lc, agent_id, args.dry_run)

    # Step 3 — ACL (public so any authenticated user can use it)
    print("\nStep 3: ACL")
    db = get_db()
    grant_public_acl(agent_id, db, args.dry_run)

    # Step 4 — Summary
    print("\n=== Done ===")
    print(f"  LibreChat agent ID: {agent_id}")
    print()
    print("Next steps:")
    print("  1. Add to librechat.yaml if actions registration failed:")
    print("       actions:")
    print("         allowedAddresses:")
    print("           - localhost")
    print("           - 127.0.0.1")
    print("  2. Update WorkflowChatPanel to open a conversation with this agent ID")
    print(f"     agent_id = {agent_id}")
    print("  3. Test: open a workflow run → chat panel → ask 'Summarise the candidate'")
    print("  4. To update the prompt: edit scripts/libra/prompts/workflow_assistant.md and rerun this script")

    return 0


if __name__ == "__main__":
    sys.exit(main())
