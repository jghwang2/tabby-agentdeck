# -*- coding: utf-8 -*-
"""Install or remove AgentDeck's Antigravity lifecycle hooks without changing permissions."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import uuid

GROUP = "tabby-agentdeck"
EVENTS = ("PreInvocation", "PreToolUse", "PostToolUse", "PostInvocation", "Stop")


def command(event):
    script = Path(__file__).resolve().parent.parent / "hooks" / "agentdeck-agy-notify.py"
    parts = [sys.executable, str(script), event]
    rendered = subprocess.list2cmdline(parts) if os.name == "nt" else " ".join(shlex.quote(part) for part in parts)
    return {"type": "command", "command": rendered, "timeout": 5}


def own_group():
    group = {}
    for event in EVENTS:
        if event in ("PreToolUse", "PostToolUse"):
            group[event] = [{"matcher": "*", "hooks": [command(event)]}]
        else:
            group[event] = [command(event)]
    return group


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = path.with_name(path.name + ".agentdeck-backup-" + stamp + "-" + uuid.uuid4().hex[:8])
        shutil.copy2(path, backup)
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if os.name == "nt" and path.exists():
        # Replacing a file on Windows would discard its explicit ACL. Keep the
        # existing handle and rewrite it in place; the unique backup is the rollback.
        with path.open("r+", encoding="utf-8") as file:
            file.write(serialized)
            file.truncate()
        return
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    temporary = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent,
        prefix=path.name + ".agentdeck-", suffix=".tmp", delete=False,
    )
    try:
        with temporary as file:
            file.write(serialized)
        os.chmod(temporary.name, mode)
        os.replace(temporary.name, path)
    finally:
        if os.path.exists(temporary.name):
            os.unlink(temporary.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "uninstall"))
    parser.add_argument("--file", type=Path, default=Path.home() / ".gemini" / "config" / "hooks.json")
    args = parser.parse_args()
    path = args.file.expanduser()
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("AGY hooks.json must contain a JSON object; no changes made")
    else:
        data = {}
    if args.action == "install":
        data[GROUP] = own_group()
    else:
        data.pop(GROUP, None)
    save(path, data)


if __name__ == "__main__":
    main()
