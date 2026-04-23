"""OneQuery CLI-backed tool handlers for Hermes."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import uuid


_DEFAULT_TIMEOUT_SECONDS = 90
_MAX_ROWS_CAP = 1000
_DEFAULT_MAX_ROWS = 200
_DEFAULT_MAX_BYTES = 50000
_DEFAULT_CELL_MAX_CHARS = 500


def onequery_status(args, **kwargs):
    """Check CLI availability, auth identity, and current org."""
    cli = _onequery_bin()
    if not cli:
        return _json(
            {
                "ok": False,
                "error": "onequery CLI not found on PATH",
                "recovery": "Install OneQuery CLI, then run onequery auth login.",
            }
        )

    whoami = _run_onequery(["--output", "json", "auth", "whoami"], timeout=30)
    current_org = _run_onequery(["--output", "json", "org", "current"], timeout=30)
    return _json(
        {
            "ok": whoami["ok"] and current_org["ok"],
            "cli": cli,
            "whoami": whoami,
            "current_org": current_org,
            "recovery": _status_recovery(whoami, current_org),
        }
    )


def onequery_list_sources(args, **kwargs):
    """List sources for a OneQuery org."""
    org = _required_string(args, "org")
    if not org["ok"]:
        return _json(org)
    return _json(_run_onequery(["--org", org["value"], "--output", "json", "source", "list"]))


def onequery_show_source(args, **kwargs):
    """Show one OneQuery source."""
    parsed = _required_many(args, ["org", "source"])
    if not parsed["ok"]:
        return _json(parsed)
    return _json(
        _run_onequery(
            [
                "--org",
                parsed["values"]["org"],
                "--output",
                "json",
                "source",
                "show",
                parsed["values"]["source"],
            ]
        )
    )


def onequery_validate_query(args, **kwargs):
    """Validate read-only SQL through OneQuery."""
    parsed = _required_many(args, ["org", "source", "sql"])
    if not parsed["ok"]:
        return _json(parsed)

    return _json(
        _run_onequery(
            [
                "--org",
                parsed["values"]["org"],
                "--output",
                "json",
                "query",
                "validate",
                "--source",
                parsed["values"]["source"],
                "--sql",
                parsed["values"]["sql"],
            ]
        )
    )


def onequery_execute_query(args, **kwargs):
    """Execute bounded read-only SQL through OneQuery."""
    parsed = _required_many(args, ["org", "source", "sql", "purpose", "time_bound"])
    if not parsed["ok"]:
        return _json(parsed)

    max_rows = _bounded_int(args.get("max_rows"), _DEFAULT_MAX_ROWS, 1, _MAX_ROWS_CAP)
    max_bytes = _bounded_int(args.get("max_bytes"), _DEFAULT_MAX_BYTES, 1, 5_000_000)
    cell_max_chars = _bounded_int(
        args.get("cell_max_chars"), _DEFAULT_CELL_MAX_CHARS, 1, 10000
    )
    request_id = _request_id(args.get("request_id"))

    result = _run_onequery(
        [
            "--org",
            parsed["values"]["org"],
            "--output",
            "json",
            "query",
            "exec",
            "--source",
            parsed["values"]["source"],
            "--sql",
            parsed["values"]["sql"],
            "--max-rows",
            str(max_rows),
            "--max-bytes",
            str(max_bytes),
            "--cell-max-chars",
            str(cell_max_chars),
            "--request-id",
            request_id,
        ],
        timeout=_DEFAULT_TIMEOUT_SECONDS,
    )
    result.update(
        {
            "request_id": request_id,
            "purpose": parsed["values"]["purpose"],
            "time_bound": parsed["values"]["time_bound"],
            "limits": {
                "max_rows": max_rows,
                "max_bytes": max_bytes,
                "cell_max_chars": cell_max_chars,
            },
        }
    )
    return _json(result)


def onequery_api_describe(args, **kwargs):
    """Describe a connected source API through OneQuery."""
    parsed = _required_many(args, ["org", "source"])
    if not parsed["ok"]:
        return _json(parsed)

    command = _global_args(parsed["values"]["org"], args.get("request_id"))
    command.extend(["api", "--source", parsed["values"]["source"]])
    return _json(_run_onequery(command))


def onequery_api_call(args, **kwargs):
    """Call a connected source API through OneQuery."""
    parsed = _required_many(args, ["org", "source"])
    if not parsed["ok"]:
        return _json(parsed)

    command = _global_args(parsed["values"]["org"], args.get("request_id"))
    command.extend(["api", "--source", parsed["values"]["source"]])

    optional_target = _optional_string(args, "target")
    if optional_target:
        command.append(optional_target)
    _append_option(command, "--op", _optional_string(args, "operation"))
    _append_option(command, "--method", _optional_string(args, "method"))
    _append_repeated(command, "--header", args.get("headers"))
    _append_repeated(command, "--raw-field", args.get("raw_fields"))
    _append_repeated(command, "--field", args.get("fields"))
    if args.get("paginate"):
        command.append("--paginate")
    if args.get("slurp"):
        command.append("--slurp")
    max_pages = _optional_int(args.get("max_pages"), 1, 1000)
    if max_pages is not None:
        command.extend(["--max-pages", str(max_pages)])
    if args.get("include"):
        command.append("--include")
    if args.get("silent"):
        command.append("--silent")
    _append_option(command, "--jq", _optional_string(args, "jq"))
    if args.get("dry_run"):
        command.append("--dry-run")

    stdin = args.get("input")
    if isinstance(stdin, str):
        command.extend(["--input", "-"])
    else:
        stdin = None

    result = _run_onequery(command, timeout=_DEFAULT_TIMEOUT_SECONDS, stdin=stdin)
    result.update(
        {
            "request_id": _extract_request_id(command),
            "target": optional_target,
            "operation": _optional_string(args, "operation"),
            "dry_run": bool(args.get("dry_run")),
        }
    )
    return _json(result)


def _onequery_bin():
    configured = os.environ.get("ONEQUERY_BIN")
    if configured:
        return configured if shutil.which(configured) or os.path.exists(configured) else None
    return shutil.which("onequery")


def _run_onequery(arguments, timeout=_DEFAULT_TIMEOUT_SECONDS, stdin=None):
    cli = _onequery_bin()
    if not cli:
        return {
            "ok": False,
            "error": "onequery CLI not found on PATH",
            "command": ["onequery"] + list(arguments),
        }

    command = [cli] + list(arguments)
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            input=stdin,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "error": "onequery command timed out",
            "command": _redacted_command(command),
            "timeout_seconds": timeout,
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "command": _redacted_command(command),
        }

    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    return {
        "ok": completed.returncode == 0,
        "exit_code": completed.returncode,
        "command": _redacted_command(command),
        "stdout": stdout,
        "stderr": stderr,
        "parsed_stdout": _try_parse_json(stdout),
    }


def _required_string(args, key):
    value = args.get(key) if isinstance(args, dict) else None
    if not isinstance(value, str) or not value.strip():
        return {"ok": False, "error": "%s is required" % key}
    return {"ok": True, "value": value.strip()}


def _optional_string(args, key):
    value = args.get(key) if isinstance(args, dict) else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _required_many(args, keys):
    values = {}
    for key in keys:
        parsed = _required_string(args, key)
        if not parsed["ok"]:
            return parsed
        values[key] = parsed["value"]
    return {"ok": True, "values": values}


def _bounded_int(value, default, lower, upper):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(lower, min(number, upper))


def _optional_int(value, lower, upper):
    if value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return max(lower, min(number, upper))


def _append_option(command, flag, value):
    if value:
        command.extend([flag, value])


def _append_repeated(command, flag, values):
    if not isinstance(values, list):
        return
    for value in values:
        if isinstance(value, str) and value.strip():
            command.extend([flag, value.strip()])


def _global_args(org, request_id):
    command = ["--org", org, "--output", "json"]
    actual_request_id = _request_id(request_id)
    command.extend(["--request-id", actual_request_id])
    return command


def _extract_request_id(command):
    try:
        index = command.index("--request-id")
        return command[index + 1]
    except (ValueError, IndexError):
        return None


def _request_id(value):
    if isinstance(value, str) and value.strip():
        return value.strip()
    return "hermes-%s-%s" % (time.strftime("%Y%m%d%H%M%S"), uuid.uuid4().hex[:8])


def _try_parse_json(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def _redacted_command(command):
    redacted = []
    skip_value = False
    secret_flags = {"--token", "--password", "--secret", "--api-key", "--header"}
    for part in command:
        if skip_value:
            redacted.append("<redacted>")
            skip_value = False
            continue
        redacted.append(part)
        if part in secret_flags:
            skip_value = True
    return redacted


def _status_recovery(whoami, current_org):
    if not whoami["ok"]:
        return "Run onequery auth login, then retry onequery_status."
    if not current_org["ok"]:
        return "Run onequery org list and choose an org, or pass org explicitly to tools."
    return None


def _json(value):
    return json.dumps(value, sort_keys=True)
