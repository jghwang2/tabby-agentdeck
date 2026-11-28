# -*- coding: utf-8 -*-
"""Translate Antigravity CLI lifecycle hooks into AgentDeck notifications.

Only documented metadata is forwarded. The AGY permission decision remains with
AGY: PreToolUse returns "allow" (delegate), never "auto_approve".
"""
import json
import os
import sys
import time
import uuid

from agentdeck_relay import env, origin_pid, runtime_root, send

EVENTS = {"PreInvocation", "PreToolUse", "PostToolUse", "PostInvocation", "Stop"}


def hook_response(event):
    # "allow" delegates to the next hook/default policy; it is not auto_approve.
    if event == "PreToolUse":
        return {"decision": "allow"}
    if event == "Stop":
        # Any value other than "continue" permits the stop; include the required field.
        return {"decision": "stop"}
    return {}


def main():
    event = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    except Exception:
        data = None
    if event not in EVENTS or not isinstance(data, dict):
        sys.stdout.write(json.dumps(hook_response(event), separators=(",", ":")) + "\n")
        return

    session_id = data.get("conversationId")
    if not isinstance(session_id, str) or not session_id:
        sys.stdout.write(json.dumps(hook_response(event), separators=(",", ":")) + "\n")
        return

    status = "running"
    if event == "Stop":
        if data.get("terminationReason") == "error" or bool(data.get("error")):
            status = "error"
        elif data.get("fullyIdle") is True:
            status = "done"

    workspaces = data.get("workspacePaths")
    cwd = workspaces[0] if isinstance(workspaces, list) and workspaces and isinstance(workspaces[0], str) else ""
    tool_call = data.get("toolCall") if isinstance(data.get("toolCall"), dict) else {}
    hook = {"session_id": session_id, "hook_event_name": event}
    if cwd:
        hook["cwd"] = cwd
    if isinstance(tool_call.get("name"), str):
        hook["tool_name"] = tool_call["name"]
    args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
    if isinstance(args.get("TargetFile"), str) and args["TargetFile"]:
        hook["tool_input"] = {"file_path": args["TargetFile"]}

    event_id = str(uuid.uuid4())
    payload = {
        "channel": "agentdeck-hook", "id": event_id, "ts": int(time.time() * 1000), "kind": "notify",
        "pid": origin_pid(),
        "env": {key: env(key) for key in ("AGENTDECK_TAB", "AGENTDECK_CONTEXT")},
        "options": {"Agent": "agy", "Status": status},
        "hook": hook,
    }
    line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(line.encode("utf-8")) <= 240000:
        delivered, _ = send(runtime_root(), line, event_id)
        if not delivered:
            try:
                inbox = os.path.join(runtime_root(), "hook-inbox")
                os.makedirs(inbox, exist_ok=True)
                target = os.path.join(inbox, event_id + ".json")
                with open(target + ".tmp", "w", encoding="utf-8") as file:
                    file.write(line)
                os.replace(target + ".tmp", target)
            except OSError:
                pass
    # AGY expects its own schema, not AgentDeck's mailbox/context response.
    sys.stdout.write(json.dumps(hook_response(event), separators=(",", ":")) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Reporting must never block or alter the agent turn.
        try:
            event = sys.argv[1] if len(sys.argv) > 1 else ""
            sys.stdout.write(json.dumps(hook_response(event), separators=(",", ":")) + "\n")
        except Exception:
            pass
