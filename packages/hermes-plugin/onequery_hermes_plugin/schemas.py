"""Tool schemas for the OneQuery Hermes plugin."""

ONEQUERY_STATUS = {
    "name": "onequery_status",
    "description": (
        "Check whether the OneQuery CLI is installed and whether the current "
        "environment is authenticated. Use before internal data analysis or "
        "when OneQuery access appears broken."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

ONEQUERY_LIST_SOURCES = {
    "name": "onequery_list_sources",
    "description": (
        "List data sources available in a specific OneQuery org. Use this to "
        "resolve an internal data source before writing SQL."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "org": {
                "type": "string",
                "description": "OneQuery organization slug, for example 'acme'.",
            },
        },
        "required": ["org"],
    },
}

ONEQUERY_SHOW_SOURCE = {
    "name": "onequery_show_source",
    "description": (
        "Show provider, status, and query capability for one OneQuery source. "
        "Use this before validating or executing SQL against that source."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "org": {
                "type": "string",
                "description": "OneQuery organization slug.",
            },
            "source": {
                "type": "string",
                "description": "Canonical OneQuery source key.",
            },
        },
        "required": ["org", "source"],
    },
}

ONEQUERY_VALIDATE_QUERY = {
    "name": "onequery_validate_query",
    "description": (
        "Validate a read-only, single-statement SQL query with OneQuery before "
        "execution. OneQuery owns SQL policy, access checks, and validation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "org": {
                "type": "string",
                "description": "OneQuery organization slug.",
            },
            "source": {
                "type": "string",
                "description": "Canonical OneQuery source key.",
            },
            "sql": {
                "type": "string",
                "description": "Read-only SQL to validate.",
            },
        },
        "required": ["org", "source", "sql"],
    },
}

ONEQUERY_EXECUTE_QUERY = {
    "name": "onequery_execute_query",
    "description": (
        "Execute a bounded read-only SQL query through OneQuery. Use only after "
        "source context is resolved and query validation has passed. Requires a "
        "clear purpose and time_bound so analysis stays auditable and scoped."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "org": {
                "type": "string",
                "description": "OneQuery organization slug.",
            },
            "source": {
                "type": "string",
                "description": "Canonical OneQuery source key.",
            },
            "sql": {
                "type": "string",
                "description": "Read-only SQL to execute.",
            },
            "purpose": {
                "type": "string",
                "description": "Human-readable analysis purpose for audit context.",
            },
            "time_bound": {
                "type": "string",
                "description": "Natural-language time scope, for example 'last 14 days'.",
            },
            "request_id": {
                "type": "string",
                "description": "Stable request id for correlating related OneQuery calls.",
            },
            "max_rows": {
                "type": "integer",
                "description": "Maximum rows to return. Defaults to 200 and is capped at 1000.",
            },
            "max_bytes": {
                "type": "integer",
                "description": "Maximum response bytes. Defaults to 50000.",
            },
            "cell_max_chars": {
                "type": "integer",
                "description": "Maximum characters per cell. Defaults to 500.",
            },
        },
        "required": ["org", "source", "sql", "purpose", "time_bound"],
    },
}

ONEQUERY_API_DESCRIBE = {
    "name": "onequery_api_describe",
    "description": (
        "Describe a connected OneQuery source API. Use this before calling "
        "source API operations so Hermes can see available targets and operations."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "org": {
                "type": "string",
                "description": "OneQuery organization slug.",
            },
            "source": {
                "type": "string",
                "description": "Canonical OneQuery source key.",
            },
            "request_id": {
                "type": "string",
                "description": "Stable request id for correlating related OneQuery calls.",
            },
        },
        "required": ["org", "source"],
    },
}

ONEQUERY_API_CALL = {
    "name": "onequery_api_call",
    "description": (
        "Call a connected OneQuery source API through `onequery api`. OneQuery "
        "owns source API permissions, request preparation, execution, and policy."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "org": {
                "type": "string",
                "description": "OneQuery organization slug.",
            },
            "source": {
                "type": "string",
                "description": "Canonical OneQuery source key.",
            },
            "target": {
                "type": "string",
                "description": "Optional selector or inferred operation target.",
            },
            "operation": {
                "type": "string",
                "description": "Optional operation override passed as `--op`.",
            },
            "method": {
                "type": "string",
                "description": "Optional HTTP method override for `http_request` operations.",
            },
            "headers": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional request headers as `KEY:VALUE` strings.",
            },
            "raw_fields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional string field patches as `KEY=VALUE` strings.",
            },
            "fields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional typed field patches as `KEY=VALUE` strings.",
            },
            "input": {
                "type": "string",
                "description": "Optional request body. Passed to `onequery api --input -` via stdin.",
            },
            "paginate": {
                "type": "boolean",
                "description": "Follow opaque source API pagination tokens.",
            },
            "slurp": {
                "type": "boolean",
                "description": "Combine paginated JSON bodies into one array before rendering.",
            },
            "max_pages": {
                "type": "integer",
                "description": "Maximum paginated requests to follow.",
            },
            "include": {
                "type": "boolean",
                "description": "Include status and allowed response headers in text output.",
            },
            "silent": {
                "type": "boolean",
                "description": "Suppress body output.",
            },
            "jq": {
                "type": "string",
                "description": "Apply a JSON selection expression after response assembly.",
            },
            "dry_run": {
                "type": "boolean",
                "description": "Print the normalized request plan without executing it.",
            },
            "request_id": {
                "type": "string",
                "description": "Stable request id for correlating related OneQuery calls.",
            },
        },
        "required": ["org", "source"],
    },
}
