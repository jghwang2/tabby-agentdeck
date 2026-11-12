# -*- coding: utf-8 -*-
"""Local AgentDeck transport. State and deduplication remain in the receiver."""
import hashlib
import json
import os
import socket
import sys
import time
import uuid

BUDGET_MS = 2200
HOOK_FIELDS = ("session_id", "hook_event_name", "agent_id", "agent_type", "cwd", "tool_name",
               "message", "error", "last_assistant_message")
ENV_KEYS = ("AGENTDECK_TAB", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "AGENTDECK_CONTEXT")
OPTION_KEYS = {"-Agent", "-Status", "-Label", "-Subagent", "-SessionId", "-MaxLabel"}


def env(key):
    return os.environ.get(key, "")


def runtime_root():
    if env("AGENTDECK_RUNTIME_ROOT"):
        return env("AGENTDECK_RUNTIME_ROOT")
    accounts = env("AGENTDECK_ACCOUNTS_FILE") or os.path.join(os.path.expanduser("~"), ".agentdeck", "accounts.json")
    root = os.path.join(os.path.dirname(accounts), "runtime")
    profile = env("TABBY_CONFIG_DIRECTORY")
    if profile:
        full = os.path.abspath(profile)  # GetFullPathNameW: lexical, no 8.3 expansion
        if len(full) > len(os.path.splitdrive(full)[0]) + 1:
            full = full.rstrip("\\/")
        root = os.path.join(root, hashlib.sha256(full.lower().encode("utf-8")).hexdigest()[:16])
    return root


def origin_pid():
    try:
        pid = int(env("AGENTDECK_ORIGIN_PID"))
        if pid:
            return pid
    except ValueError:
        pass
    return os.getppid()


def send(root, line, event_id):
    """Returns (delivered, output)."""
    start = time.perf_counter()

    def remaining():
        return max(0.001, (BUDGET_MS - (time.perf_counter() - start) * 1000) / 1000)

    try:
        with open(os.path.join(root, "port"), encoding="utf-8") as f:
            port = int(f.read().strip())
        with socket.create_connection(("127.0.0.1", port), timeout=remaining()) as sock:
            sock.settimeout(remaining())
            sock.sendall((line + "\n").encode("utf-8"))
            response = bytearray()
            while (time.perf_counter() - start) * 1000 < BUDGET_MS:
                sock.settimeout(remaining())
                chunk = sock.recv(4096)
                if not chunk:
                    return False, ""
                end = chunk.find(b"\n")
                response += chunk if end < 0 else chunk[:end]
                if len(response) > 1048576:
                    return False, ""
                if end < 0:
                    continue
                text = response.decode("utf-8")
                if len(text) > 262144:
                    return False, ""
                reply = json.loads(text)
                if not isinstance(reply, dict) or reply.get("id") != event_id or reply.get("accepted") is not True:
                    return False, ""
                output = reply.get("output")
                return True, output if isinstance(output, str) else ""
    except Exception:
        pass  # offline, malformed or late ACK: retain the same event ID
    return False, ""


def main(codex=False):
    options = {"Agent": "codex" if codex else "claude"}
    args = sys.argv[1:]
    if not codex:
        options["MaxLabel"] = 40
        i = 0
        while i < len(args):
            if args[i] in OPTION_KEYS and i + 1 < len(args):
                options[args[i][1:]] = args[i + 1]
                i += 1
            i += 1

    data = None
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except Exception:
        pass
    if not isinstance(data, dict):
        if "SessionId" not in options:
            return
        data = {}

    hook = {k: data[k] for k in HOOK_FIELDS if k in data}
    tool_input = data.get("tool_input")
    if isinstance(tool_input, dict) and isinstance(tool_input.get("file_path"), str) and tool_input["file_path"]:
        hook["tool_input"] = {"file_path": tool_input["file_path"]}

    event_id = str(uuid.uuid4())
    root = runtime_root()
    payload = {
        "channel": "agentdeck-hook", "id": event_id, "ts": int(time.time() * 1000), "kind": "notify",
        "pid": origin_pid(), "env": {k: env(k) for k in ENV_KEYS}, "options": options, "hook": hook,
    }
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(line.encode("utf-8")) > 240000:
        return

    delivered, output = send(root, line, event_id)
    if not delivered:
        try:
            inbox = os.path.join(root, "hook-inbox")
            os.makedirs(inbox, exist_ok=True)
            target = os.path.join(inbox, event_id + ".json")
            with open(target + ".tmp", "w", encoding="utf-8") as f:
                f.write(line)
            os.replace(target + ".tmp", target)
        except OSError:
            pass  # reporting must never block the agent
    sys.stdout.buffer.write(output.encode("utf-8"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # invalid input is silent
