"""OneQuery Hermes plugin registration."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from . import schemas, tools


logger = logging.getLogger(__name__)
_TOOL_CALLS = []


def _on_post_tool_call(tool_name, args, result, task_id, **kwargs):
    """Track recent OneQuery tool calls for local diagnostics."""
    if not tool_name.startswith("onequery_"):
        return
    _TOOL_CALLS.append(
        {
            "tool": tool_name,
            "task_id": task_id,
            "ok": _result_ok(result),
        }
    )
    if len(_TOOL_CALLS) > 50:
        _TOOL_CALLS.pop(0)
    logger.debug("OneQuery tool called: %s task=%s", tool_name, task_id)


def _handle_slash_command(raw_args):
    """Handle /onequery in Hermes sessions."""
    subcommand = (raw_args or "").strip().lower()
    if subcommand in {"", "status"}:
        return tools.onequery_status({})
    if subcommand == "recent":
        return json.dumps({"recent_tool_calls": list(_TOOL_CALLS)}, sort_keys=True)
    return "Usage: /onequery [status|recent]"


def register(ctx):
    """Register OneQuery tools, bundled skills, hooks, and commands."""
    ctx.register_tool(
        name="onequery_status",
        toolset="onequery",
        schema=schemas.ONEQUERY_STATUS,
        handler=tools.onequery_status,
    )
    ctx.register_tool(
        name="onequery_list_sources",
        toolset="onequery",
        schema=schemas.ONEQUERY_LIST_SOURCES,
        handler=tools.onequery_list_sources,
    )
    ctx.register_tool(
        name="onequery_show_source",
        toolset="onequery",
        schema=schemas.ONEQUERY_SHOW_SOURCE,
        handler=tools.onequery_show_source,
    )
    ctx.register_tool(
        name="onequery_validate_query",
        toolset="onequery",
        schema=schemas.ONEQUERY_VALIDATE_QUERY,
        handler=tools.onequery_validate_query,
    )
    ctx.register_tool(
        name="onequery_execute_query",
        toolset="onequery",
        schema=schemas.ONEQUERY_EXECUTE_QUERY,
        handler=tools.onequery_execute_query,
    )

    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_command(
        "onequery",
        handler=_handle_slash_command,
        description="Show OneQuery plugin status and recent tool calls",
    )

    skills_dir = Path(__file__).resolve().parent.parent / "skills"
    if skills_dir.exists():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.exists():
                ctx.register_skill(child.name, skill_md)


def _result_ok(result):
    try:
        return bool(json.loads(result).get("ok"))
    except Exception:
        return False

