"""OneQuery CLI-backed tool handlers for Hermes."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid


_DEFAULT_TIMEOUT_SECONDS = 90
_MAX_ROWS_CAP = 1000
_DEFAULT_MAX_ROWS = 200
_DEFAULT_MAX_BYTES = 50000
_DEFAULT_CELL_MAX_CHARS = 500

_FORBIDDEN_SQL = re.compile(
    r"\b("
    r"insert|update|delete|drop|alter|truncate|create|replace|grant|revoke|"
    r"merge|call|copy|load|unload|vacuum|analyze|attach|detach|pragma"
    r")\b",
    re.IGNORECASE,
)
_SENSITIVE_COLUMNS = re.compile(
    r"\b("
    r"email|phone|name|address|ip_address|user_agent|ssn|tax_id|card|"
    r"token|secret|password|api_key|session|cookie"
    r")\b",
    re.IGNORECASE,
)


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

    whoami = _run_onequery(["auth", "whoami"], timeout=30)
    current_org = _run_onequery(["org", "current"], timeout=30)
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
    return _json(_run_onequery(["--org", org["value"], "source", "list"]))


def onequery_show_source(args, **kwargs):
    """Show one OneQuery source."""
    parsed = _required_many(args, ["org", "source"])
    if not parsed["ok"]:
        return _json(parsed)
    return _json(
        _run_onequery(
            ["--org", parsed["values"]["org"], "source", "show", parsed["values"]["source"]]
        )
    )


def onequery_validate_query(args, **kwargs):
    """Validate read-only SQL through OneQuery."""
    parsed = _required_many(args, ["org", "source", "sql"])
    if not parsed["ok"]:
        return _json(parsed)

    policy = _check_sql_policy(
        parsed["values"]["sql"],
        allow_select_star=bool(args.get("allow_select_star")),
        allow_sensitive_columns=bool(args.get("allow_sensitive_columns")),
    )
    if not policy["ok"]:
        return _json(policy)

    return _json(
        _run_onequery(
            [
                "--org",
                parsed["values"]["org"],
                "query",
                "validate",
                "--source",
                parsed["values"]["source"],
                "--sql",
                policy["sql"],
            ]
        )
    )


def onequery_execute_query(args, **kwargs):
    """Execute bounded read-only SQL through OneQuery."""
    parsed = _required_many(args, ["org", "source", "sql", "purpose", "time_bound"])
    if not parsed["ok"]:
        return _json(parsed)

    policy = _check_sql_policy(
        parsed["values"]["sql"],
        allow_select_star=bool(args.get("allow_select_star")),
        allow_sensitive_columns=bool(args.get("allow_sensitive_columns")),
    )
    if not policy["ok"]:
        return _json(policy)

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
            "query",
            "exec",
            "--source",
            parsed["values"]["source"],
            "--sql",
            policy["sql"],
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


def _onequery_bin():
    configured = os.environ.get("ONEQUERY_BIN")
    if configured:
        return configured if shutil.which(configured) or os.path.exists(configured) else None
    return shutil.which("onequery")


def _run_onequery(arguments, timeout=_DEFAULT_TIMEOUT_SECONDS):
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


def _check_sql_policy(sql, allow_select_star=False, allow_sensitive_columns=False):
    if not isinstance(sql, str) or not sql.strip():
        return {"ok": False, "error": "sql is required"}

    normalized = sql.strip()
    without_trailing = normalized.rstrip(";").strip()
    scrubbed = _strip_sql_comments(without_trailing)
    lowered = scrubbed.lower().lstrip()

    if ";" in without_trailing:
        return {
            "ok": False,
            "error": "Policy blocked query: multiple SQL statements are not allowed",
        }
    if not (lowered.startswith("select ") or lowered.startswith("with ")):
        return {
            "ok": False,
            "error": "Policy blocked query: only SELECT or WITH read-only SQL is allowed",
        }
    forbidden = _FORBIDDEN_SQL.search(scrubbed)
    if forbidden:
        return {
            "ok": False,
            "error": "Policy blocked query: forbidden SQL keyword",
            "keyword": forbidden.group(1).lower(),
        }
    if not allow_select_star and re.search(r"select\s+\*", scrubbed, re.IGNORECASE):
        return {
            "ok": False,
            "error": "Policy blocked query: SELECT * requires explicit approval",
        }
    sensitive = sorted(set(m.group(1).lower() for m in _SENSITIVE_COLUMNS.finditer(scrubbed)))
    if sensitive and not allow_sensitive_columns:
        return {
            "ok": False,
            "error": "Policy blocked query: sensitive column-like terms require explicit approval",
            "sensitive_terms": sensitive,
        }

    return {"ok": True, "sql": without_trailing, "policy_warnings": []}


def _strip_sql_comments(sql):
    no_block_comments = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--.*?$", " ", no_block_comments, flags=re.MULTILINE)


def _required_string(args, key):
    value = args.get(key) if isinstance(args, dict) else None
    if not isinstance(value, str) or not value.strip():
        return {"ok": False, "error": "%s is required" % key}
    return {"ok": True, "value": value.strip()}


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
    secret_flags = {"--token", "--password", "--secret", "--api-key"}
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

