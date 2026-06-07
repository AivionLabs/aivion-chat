"""Lightweight `.env` loader for LibreChat admin scripts.

This stays dependency-free so the onboarding scripts can run without
installing `python-dotenv`.
"""

from __future__ import annotations

import os
from pathlib import Path


def _candidate_paths() -> list[Path | None]:
    here = Path(__file__).resolve()
    env_file = os.environ.get("LIBRECHAT_ENV_FILE")
    return [
        Path(env_file).expanduser() if env_file else None,
        Path.cwd() / ".env",
        Path.cwd() / ".env.local",
        here.parent / ".env",
        here.parent / ".env.local",
        here.parents[2] / ".env",
        here.parents[2] / ".env.local",
    ]


def _parse_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return value


def load_local_env() -> None:
    """Load unset environment variables from common local `.env` files."""

    for path in _candidate_paths():
        if path is None or not path.exists() or not path.is_file():
            continue

        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("export "):
                stripped = stripped[7:].lstrip()
            if "=" not in stripped:
                continue

            key, raw_value = stripped.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue

            raw_value = raw_value.split(" #", 1)[0].strip()
            os.environ[key] = _parse_value(raw_value)

