"""Shared LibreChat API client for admin scripts.

Auth: a user-generated API key from LibreChat UI → Settings → API Keys.
The key must belong to an ADMIN account.

Requires httpx:
    pip install httpx
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://localhost:3080"
DEFAULT_TIMEOUT = 30.0


def _login(base_url: str, email: str, password: str) -> str:
    """Log in to LibreChat and return a JWT token."""
    r = httpx.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        timeout=DEFAULT_TIMEOUT,
    )
    if not r.is_success:
        print(f"error: login failed ({r.status_code}): {r.text}", file=sys.stderr)
        sys.exit(1)
    token = r.json().get("token")
    if not token:
        print("error: no token in login response", file=sys.stderr)
        sys.exit(1)
    return token


class LibreChatAdmin:
    def __init__(self, base_url: str | None = None, api_key: str | None = None) -> None:
        url = base_url or os.environ.get("LIBRECHAT_URL", DEFAULT_BASE_URL)
        self.base_url = url.rstrip("/")

        # Prefer email/password login (gets a JWT that works for all endpoints).
        # Fall back to LIBRECHAT_API_KEY if set.
        email = os.environ.get("LIBRECHAT_EMAIL", "")
        password = os.environ.get("LIBRECHAT_PASSWORD", "")
        key = api_key or os.environ.get("LIBRECHAT_API_KEY", "")

        if email and password:
            key = _login(self.base_url, email, password)
            print(f"  logged in as {email}")
        elif not key:
            print(
                "error: set LIBRECHAT_EMAIL + LIBRECHAT_PASSWORD (recommended) "
                "or LIBRECHAT_API_KEY.",
                file=sys.stderr,
            )
            sys.exit(1)

        self.client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
            timeout=DEFAULT_TIMEOUT,
        )

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "LibreChatAdmin":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def ping(self) -> bool:
        try:
            r = self.client.get("/api/health")
            return r.status_code < 400
        except Exception:
            return False

    # ------------------------------------------------------------------ #
    # Agents                                                               #
    # ------------------------------------------------------------------ #

    def list_agents(self) -> list[dict[str, Any]]:
        r = self.client.get("/api/agents")
        r.raise_for_status()
        data = r.json()
        return data.get("data") or data if isinstance(data, list) else []

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        r = self.client.get(f"/api/agents/{agent_id}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def create_agent(self, body: dict[str, Any]) -> dict[str, Any]:
        r = self.client.post("/api/agents", json=body)
        r.raise_for_status()
        return r.json()

    def update_agent(self, agent_id: str, body: dict[str, Any]) -> dict[str, Any]:
        r = self.client.patch(f"/api/agents/{agent_id}", json=body)
        r.raise_for_status()
        return r.json()

    def find_agent_by_name(self, name: str) -> dict[str, Any] | None:
        for agent in self.list_agents():
            if agent.get("name") == name:
                return agent
        return None

    def upsert_agent(self, body: dict[str, Any]) -> dict[str, Any]:
        name = body["name"]
        existing = self.find_agent_by_name(name)
        if existing:
            agent_id = existing["id"]
            result = self.update_agent(agent_id, body)
            print(f"  agent '{name}' updated (id={agent_id})")
            return result
        result = self.create_agent(body)
        print(f"  agent '{name}' created (id={result.get('id')})")
        return result
