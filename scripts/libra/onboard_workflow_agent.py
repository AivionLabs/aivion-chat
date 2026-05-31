"""One-shot onboarding for the Workflow Assistant agent.

Creates a LibreChat agent scoped to workflow runs — it can answer questions
about candidates, assessments, and next steps, and call workflow API actions
(get_run, resume_run, cancel_run, list_runs) directly from the chat.

Steps:
  1. Register the system prompt in Bifrost Prompt Repository
  2. Commit version 1 of the prompt
  3. Create (or update) the LibreChat agent
  4. Register the workflow actions (OpenAPI spec → POST /api/agents/actions/:id)
  5. Set org-member-only ACL (NOT public marketplace)

Run from the repo root:
    python scripts/libra/onboard_workflow_agent.py
    python scripts/libra/onboard_workflow_agent.py --dry-run

Env vars:
    LIBRECHAT_URL       default: http://localhost:3081
    LIBRECHAT_API_KEY   admin user API key (Settings → API Keys in LibreChat UI)
    BIFROST_URL         default: http://localhost:8081
    MONGO_URI           default: mongodb://localhost:27018/LibreChat
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # AivionLabsNew/

sys.path.insert(0, str(REPO_ROOT / "aivion-router" / "scripts" / "bifrost"))
sys.path.insert(0, str(Path(__file__).parent))

from _client import BifrostAdmin  # noqa: E402
from _librechat import LibreChatAdmin  # noqa: E402
from _mongo import get_db  # noqa: E402

# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

AGENT_NAME = "Workflow Assistant"
PROMPT_NAME = "workflow-cv-screening"

# Call aivion-workflow directly — localhost:8004 is already in
# librechat.yaml → actions.allowedAddresses, no config change needed.
# Auth: INTERNAL_SERVICE_TOKEN as Bearer (service_http).
WORKFLOW_BASE_URL = "http://localhost:8004"

PROMPT_CONTENT = """\
You are the Aivion Workflow Assistant — an AI scoped strictly to workflow runs.
You help recruiters and operators understand run results and take the right next action.

## Scope
Answer ONLY questions about:
- The current workflow run (candidate profile, fit score, assessment, strengths, gaps, red flags)
- What action to take next (shortlist, reject, schedule a screen call)
- Other workflow runs belonging to the user
- HR best practices directly relevant to the candidate under review

Politely decline any question not related to workflows or the current run.
Example: "I'm focused on workflow runs — I can't help with that, but happy to discuss this candidate."

## Tools you have
Use these tools when the user asks for information or wants to take an action:

- **get_run(run_id)** — fetch full details of a run: candidate name, score, summary,
  strengths, gaps, red flags, AI recommendation, current status.
  Call this when the user asks about the candidate or the assessment.

- **resume_run(run_id, decision, recruiter_notes)** — complete the human review gate.
  decision must be one of: "shortlist", "reject", "screen_call".
  Always confirm with the user before calling this — it advances the workflow.

- **cancel_run(run_id)** — cancel a running workflow. Confirm before calling.

- **list_runs(status)** — list the user's workflow runs. status: "running",
  "awaiting_user", "completed", "failed", "cancelled", or omit for all.

## How to respond

1. When the user asks about a candidate — call get_run, then summarise clearly:
   - Fit score and one-line verdict
   - Top 2-3 strengths
   - Key gaps or red flags
   - AI recommendation

2. When the user wants to take action (shortlist/reject/screen) — confirm first:
   "Are you sure you want to [action] [candidate name]? I'll update the workflow."
   After confirmation, call resume_run.

3. Keep answers concise. Use bullet points for lists.
   Produce a summary card when you have full candidate details.

## Tone
Professional, helpful, direct. You are a tool for busy recruiters — no fluff.
"""

COMMIT_MESSAGE = "Initial version — Workflow Assistant scoped to run Q&A and HUMAN gate actions"

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
                "summary": "Complete the human review gate (shortlist / reject / screen_call)",
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
                                        "properties": {
                                            "decision": {
                                                "type": "string",
                                                "enum": ["shortlist", "reject", "screen_call"],
                                            },
                                            "recruiter_notes": {"type": "string"},
                                        },
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
            "description": "Get full details of a workflow run including candidate profile, fit score, assessment, strengths, gaps, red flags, and current status.",
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
            "description": "Complete the human review gate to advance the workflow. decision must be shortlist, reject, or screen_call.",
            "parameters": {
                "type": "object",
                "required": ["run_id", "decision"],
                "properties": {
                    "run_id": {"type": "string", "description": "The workflow run UUID"},
                    "decision": {
                        "type": "string",
                        "enum": ["shortlist", "reject", "screen_call"],
                        "description": "Recruiter decision",
                    },
                    "recruiter_notes": {
                        "type": "string",
                        "description": "Optional notes from the recruiter",
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
    "description": "Workflow Assistant · Ask about candidates, assessments, and next steps. Can shortlist, reject, or cancel runs.",
    "instructions": PROMPT_CONTENT,
    "provider": "Aivion",
    "model": "aivion-free",
    "tools": [],  # populated after action registration
    "capabilities": ["artifacts"],
    "conversation_starters": [
        "Summarise the candidate for me",
        "What are the key red flags?",
        "Shortlist this candidate",
        "Show me all pending reviews",
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def create_bifrost_prompt(admin: BifrostAdmin, dry_run: bool) -> str | None:
    existing = next((p for p in admin.list_prompts() if p.get("name") == PROMPT_NAME), None)
    if existing:
        prompt_id = existing["id"]
        print(f"  Bifrost prompt already exists: {prompt_id}")
        return prompt_id

    if dry_run:
        print(f"  (dry-run) would create Bifrost prompt '{PROMPT_NAME}'")
        return "dry-run-uuid"

    r = admin.client.post("/api/prompt-repo/prompts", json={"name": PROMPT_NAME})
    r.raise_for_status()
    prompt_id = r.json()["prompt"]["id"]
    print(f"  Bifrost prompt created: {prompt_id}")

    r2 = admin.client.post(
        f"/api/prompt-repo/prompts/{prompt_id}/versions",
        json={
            "messages": [{"role": "system", "content": PROMPT_CONTENT}],
            "commit_message": COMMIT_MESSAGE,
        },
    )
    r2.raise_for_status()
    version_number = r2.json()["version"]["version_number"]
    print(f"  Committed version {version_number}")
    return prompt_id


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

    # Step 1 — Bifrost prompt
    print("Step 1: Bifrost Prompt Repository")
    with BifrostAdmin() as admin:
        prompt_id = create_bifrost_prompt(admin, args.dry_run)

    if not prompt_id:
        print("error: failed to create Bifrost prompt", file=sys.stderr)
        return 1

    # Step 2 — LibreChat agent
    print("\nStep 2: LibreChat Agent")
    with LibreChatAdmin() as lc:
        agent_id = create_librechat_agent(lc, args.dry_run)

        if not agent_id:
            print("error: failed to create LibreChat agent", file=sys.stderr)
            return 1

        # Step 3 — Register actions
        print("\nStep 3: Workflow Actions (OpenAPI)")
        register_actions(lc, agent_id, args.dry_run)

    # Step 4 — ACL (public so any authenticated user can use it)
    print("\nStep 4: ACL")
    db = get_db()
    grant_public_acl(agent_id, db, args.dry_run)

    # Step 5 — Summary
    print("\n=== Done ===")
    print(f"  Bifrost prompt ID : {prompt_id}")
    print(f"  Bifrost version   : 1")
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
    print("  4. To update the prompt: POST a new version to Bifrost, bump bifrost_prompt_version")

    return 0


if __name__ == "__main__":
    sys.exit(main())
