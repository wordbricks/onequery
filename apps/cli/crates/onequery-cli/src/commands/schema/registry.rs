use serde_json::Value;
use serde_json::json;

use super::AuthRequirements;
use super::LocalCommandRegistryEntry;
use super::ReadControls;

const TEXT_JSON_OUTPUT_MODES: &[&str] = &["text", "json"];

pub(super) fn local_command_registry() -> Vec<LocalCommandRegistryEntry> {
    vec![
        LocalCommandRegistryEntry::new(
            "auth login",
            "local",
            "Start browser-based device authorization and persist the resulting CLI session.",
            empty_object_schema(),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["user", "credentialsStored", "warnings"],
                "properties": {
                    "user": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["id", "email", "displayName"],
                        "properties": {
                            "id": { "type": "string" },
                            "email": { "type": "string", "format": "email" },
                            "displayName": { "type": "string" }
                        }
                    },
                    "credentialsStored": { "type": "boolean" },
                    "activeOrg": { "type": ["string", "null"] },
                    "warnings": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                }
            }),
        ),
        LocalCommandRegistryEntry::new(
            "auth import",
            "local",
            "Persist a validated auth session payload for headless or pre-authorized CLI use.",
            empty_object_schema(),
            auth_import_input_schema(),
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["user", "imported", "credentialsStored", "issuedAt", "expiresAt", "lastRefresh"],
                "properties": {
                    "user": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["id", "email", "displayName"],
                        "properties": {
                            "id": { "type": "string" },
                            "email": { "type": "string", "format": "email" },
                            "displayName": { "type": ["string", "null"] }
                        }
                    },
                    "imported": { "type": "boolean" },
                    "credentialsStored": { "type": "boolean" },
                    "issuedAt": { "type": ["string", "null"], "format": "date-time" },
                    "expiresAt": { "type": ["string", "null"], "format": "date-time" },
                    "lastRefresh": { "type": ["string", "null"], "format": "date-time" },
                    "dryRun": { "type": "boolean" },
                    "validatedInput": auth_import_input_schema(),
                    "plannedEffects": string_array_schema()
                }
            }),
        )
        .with_dry_run()
        .with_raw_input(),
        LocalCommandRegistryEntry::new(
            "backup",
            "local",
            "Create a self-host backup archive from the local runtime state.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "includeSecrets": { "type": "boolean" },
                    "archivePath": { "type": ["string", "null"] }
                }
            }),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["archivePath", "archivedItems", "includedSecrets"],
                "properties": {
                    "archivePath": { "type": "string" },
                    "archivedItems": { "type": "integer" },
                    "includedSecrets": { "type": "boolean" }
                }
            }),
        ),
        LocalCommandRegistryEntry::new(
            "auth logout",
            "local",
            "Clear persisted CLI credentials and remove the locally stored active org.",
            empty_object_schema(),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["loggedOut", "credentialsRemoved", "activeOrgCleared"],
                "properties": {
                    "loggedOut": { "type": "boolean" },
                    "credentialsRemoved": { "type": "boolean" },
                    "activeOrgCleared": { "type": "boolean" },
                    "persistedCredentialsPresent": { "type": "boolean" },
                    "activeOrg": { "type": ["string", "null"] },
                    "dryRun": { "type": "boolean" },
                    "plannedEffects": string_array_schema()
                }
            }),
        )
        .with_dry_run(),
        LocalCommandRegistryEntry::new(
            "org current",
            "local",
            "Show the currently resolved org and where that resolution came from.",
            empty_object_schema(),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["org", "source", "resolved"],
                "properties": {
                    "org": { "type": ["string", "null"] },
                    "source": { "type": "string" },
                    "resolved": { "type": "boolean" }
                }
            }),
        ),
        LocalCommandRegistryEntry::new(
            "org use",
            "local",
            "Persist a new active org after verifying it is visible to the current caller.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["org"],
                "properties": {
                    "org": { "type": "string", "minLength": 1 }
                }
            }),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["activeOrg", "changed", "sourceOfTruth"],
                "properties": {
                    "activeOrg": { "type": "string" },
                    "changed": { "type": "boolean" },
                    "reason": { "type": ["string", "null"] },
                    "sourceOfTruth": { "type": "string" },
                    "dryRun": { "type": "boolean" },
                    "plannedEffects": string_array_schema()
                }
            }),
        )
        .with_dry_run()
        .requires_session(&["not_logged_in"]),
        LocalCommandRegistryEntry::new(
            "config set server",
            "local",
            "Persist the default server URL used by CLI commands when no environment override is present.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["url"],
                "properties": {
                    "url": { "type": "string", "format": "uri", "minLength": 1 }
                }
            }),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["serverUrl", "changed", "sourceOfTruth"],
                "properties": {
                    "serverUrl": { "type": "string", "format": "uri" },
                    "changed": { "type": "boolean" },
                    "sourceOfTruth": { "type": "string" },
                    "configPath": { "type": "string" }
                }
            }),
        ),
        LocalCommandRegistryEntry::new(
            "restore",
            "local",
            "Restore a self-host backup archive into the local runtime directories.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["archivePath"],
                "properties": {
                    "archivePath": { "type": "string", "minLength": 1 }
                }
            }),
            Value::Null,
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["archivePath", "configDir", "dataDir", "secretsPresent"],
                "properties": {
                    "archivePath": { "type": "string" },
                    "configDir": { "type": "string" },
                    "dataDir": { "type": "string" },
                    "secretsPresent": { "type": "boolean" }
                }
            }),
        ),
        LocalCommandRegistryEntry::new(
            "serve",
            "local",
            "Launch the self-host runtime bundle after writing the resolved launch contract.",
            empty_object_schema(),
            Value::Null,
            serve_foreground_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "serve start",
            "local",
            "Launch the self-host runtime in the foreground after bootstrapping the local foundation.",
            empty_object_schema(),
            Value::Null,
            serve_foreground_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "serve stop",
            "local",
            "Stop a running self-host runtime and clear the managed lifecycle markers.",
            empty_object_schema(),
            Value::Null,
            serve_stop_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "serve status",
            "local",
            "Inspect the derived self-host runtime paths and current local runtime markers.",
            empty_object_schema(),
            Value::Null,
            serve_status_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "serve logs",
            "local",
            "Inspect the current self-host server log path and any available preview lines.",
            empty_object_schema(),
            Value::Null,
            serve_logs_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "schema openapi",
            "discovery",
            "Print the current CLI JSON API discovery document bundled with this build.",
            empty_object_schema(),
            Value::Null,
            json!({
                "type": "object"
            }),
        ),
        LocalCommandRegistryEntry::new(
            "schema commands",
            "discovery",
            "List the current public CLI command schemas and capability flags.",
            empty_object_schema(),
            Value::Null,
            schema_commands_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "schema command",
            "discovery",
            "Resolve one public command path into its full command schema.",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["path"],
                "properties": {
                    "path": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 1
                    }
                }
            }),
            Value::Null,
            command_schema_output_schema(),
        ),
        LocalCommandRegistryEntry::new(
            "schema skills",
            "discovery",
            "Return the embedded OneQuery CLI agent skills and their guardrails.",
            empty_object_schema(),
            Value::Null,
            schema_skills_output_schema(),
        ),
    ]
}

impl LocalCommandRegistryEntry {
    fn new(
        command: &'static str,
        kind: &'static str,
        summary: &'static str,
        selector_schema: Value,
        input_schema: Value,
        output_schema: Value,
    ) -> Self {
        Self {
            command,
            kind,
            summary,
            selector_schema,
            input_schema,
            output_schema,
            read_controls: ReadControls::unsupported(),
            supports_output_modes: TEXT_JSON_OUTPUT_MODES,
            supports_fields: false,
            supports_pagination: false,
            supports_dry_run: false,
            supports_raw_input: false,
            auth_requirements: auth_none(),
            error_codes: &[],
            required_org_role: None,
        }
    }

    fn with_dry_run(mut self) -> Self {
        self.supports_dry_run = true;
        self
    }

    fn with_raw_input(mut self) -> Self {
        self.supports_raw_input = true;
        self
    }

    fn requires_session(mut self, error_codes: &'static [&'static str]) -> Self {
        self.auth_requirements = auth_session();
        self.error_codes = error_codes;
        self
    }
}

fn empty_object_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {},
        "required": [],
    })
}

fn string_array_schema() -> Value {
    json!({
        "type": "array",
        "items": {
            "type": "string",
        }
    })
}

fn serve_paths_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "configDir",
            "dataDir",
            "configPath",
            "secretsPath",
            "pgliteDir",
            "logsDir",
            "serverLogPath",
            "backupsDir",
            "runDir",
            "pidPath",
            "lockPath"
        ],
        "properties": {
            "configDir": { "type": "string" },
            "dataDir": { "type": "string" },
            "configPath": { "type": "string" },
            "secretsPath": { "type": "string" },
            "pgliteDir": { "type": "string" },
            "logsDir": { "type": "string" },
            "serverLogPath": { "type": "string" },
            "backupsDir": { "type": "string" },
            "runDir": { "type": "string" },
            "pidPath": { "type": "string" },
            "lockPath": { "type": "string" }
        }
    })
}

fn serve_runtime_state_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "running",
            "status",
            "pgliteDirPresent",
            "logFilePresent",
            "pidFilePresent",
            "lockFilePresent"
        ],
        "properties": {
            "running": { "type": "boolean" },
            "status": { "type": "string" },
            "pgliteDirPresent": { "type": "boolean" },
            "logFilePresent": { "type": "boolean" },
            "pidFilePresent": { "type": "boolean" },
            "lockFilePresent": { "type": "boolean" }
        }
    })
}

fn serve_server_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["listenHost", "port", "logLevel", "publicOrigin"],
        "properties": {
            "listenHost": { "type": "string" },
            "port": { "type": "integer" },
            "logLevel": { "type": "string" },
            "publicOrigin": { "type": ["string", "null"] }
        }
    })
}

fn serve_foreground_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "kind",
            "status"
        ],
        "properties": {
            "kind": { "const": "serve" },
            "status": { "type": "string" },
            "exitCode": { "type": ["integer", "null"] },
            "signal": { "type": ["string", "null"] }
        }
    })
}

fn serve_stop_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "kind",
            "phase",
            "bootstrapped",
            "stopIssued",
            "runtimeState",
            "paths"
        ],
        "properties": {
            "kind": { "type": "string" },
            "phase": { "type": "string" },
            "bootstrapped": { "type": "boolean" },
            "stopIssued": { "type": "boolean" },
            "stoppedPid": { "type": ["integer", "null"] },
            "runtimeState": serve_runtime_state_schema(),
            "paths": serve_paths_schema()
        }
    })
}

fn serve_status_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "kind",
            "phase",
            "bootstrapped",
            "server",
            "runtimeState",
            "paths"
        ],
        "properties": {
            "kind": { "type": "string" },
            "phase": { "type": "string" },
            "bootstrapped": { "type": "boolean" },
            "server": { "anyOf": [serve_server_schema(), { "type": "null" }] },
            "runtimeState": serve_runtime_state_schema(),
            "paths": serve_paths_schema()
        }
    })
}

fn serve_logs_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "kind",
            "phase",
            "bootstrapped",
            "logFilePresent",
            "logPath",
            "previewLines",
            "previewTruncated",
            "runtimeState",
            "paths"
        ],
        "properties": {
            "kind": { "type": "string" },
            "phase": { "type": "string" },
            "bootstrapped": { "type": "boolean" },
            "logFilePresent": { "type": "boolean" },
            "logPath": { "type": "string" },
            "previewLines": string_array_schema(),
            "previewTruncated": { "type": "boolean" },
            "runtimeState": serve_runtime_state_schema(),
            "paths": serve_paths_schema()
        }
    })
}

fn schema_commands_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["commands"],
        "properties": {
            "commands": {
                "type": "array",
                "items": command_schema_output_schema(),
            }
        }
    })
}

fn command_schema_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "command",
            "kind",
            "summary",
            "selectorSchema",
            "inputSchema",
            "outputSchema",
            "readControls",
            "supportsOutputModes",
            "supportsFields",
            "supportsPagination",
            "supportsDryRun",
            "supportsRawInput",
            "supportsHeadlessAuth",
            "authRequirements",
            "errorCodes",
            "retryableStatuses",
            "untrustedResponsePaths",
            "sanitizationProfile",
            "requiredOrgRole",
            "schemaSource",
            "http"
        ],
        "properties": {
            "command": { "type": "string" },
            "kind": { "type": "string" },
            "summary": { "type": "string" },
            "selectorSchema": { "type": "object" },
            "inputSchema": { "type": ["object", "null"] },
            "outputSchema": { "type": "object" },
            "readControls": {
                "type": "object",
                "additionalProperties": false,
                "required": ["fields", "limit", "cursor", "sort"],
                "properties": {
                    "fields": read_control_output_schema(),
                    "limit": read_control_output_schema(),
                    "cursor": read_control_output_schema(),
                    "sort": read_control_output_schema()
                }
            },
            "supportsOutputModes": string_array_schema(),
            "supportsFields": { "type": "boolean" },
            "supportsPagination": { "type": "boolean" },
            "supportsDryRun": { "type": "boolean" },
            "supportsRawInput": { "type": "boolean" },
            "supportsHeadlessAuth": { "type": "boolean" },
            "authRequirements": {
                "type": "object",
                "additionalProperties": false,
                "required": ["authenticated", "modes", "orgScoped"],
                "properties": {
                    "authenticated": { "type": "boolean" },
                    "modes": string_array_schema(),
                    "orgScoped": { "type": "boolean" }
                }
            },
            "errorCodes": string_array_schema(),
            "retryableStatuses": {
                "type": "array",
                "items": { "type": "integer" }
            },
            "untrustedResponsePaths": string_array_schema(),
            "sanitizationProfile": { "type": ["string", "null"] },
            "requiredOrgRole": { "type": ["string", "null"] },
            "schemaSource": { "type": "string" },
            "http": {
                "type": ["object", "null"],
                "additionalProperties": false,
                "required": ["method", "path", "operationId"],
                "properties": {
                    "method": { "type": "string" },
                    "path": { "type": "string" },
                    "operationId": { "type": "string" }
                }
            }
        }
    })
}

fn read_control_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["support", "unsupportedReason"],
        "properties": {
            "support": {
                "type": "string",
                "enum": ["supported", "unsupported"]
            },
            "unsupportedReason": {
                "type": ["string", "null"],
                "enum": ["not_available", "not_paginated", "not_sortable", null]
            }
        }
    })
}

fn schema_skills_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["skills"],
        "properties": {
            "skills": {
                "type": "array",
                "items": skill_schema_output_schema()
            }
        }
    })
}

fn skill_schema_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "description", "kind", "path", "rootSkill", "guardrails"],
        "properties": {
            "name": { "type": "string" },
            "description": { "type": "string" },
            "kind": { "type": "string" },
            "path": { "type": "string" },
            "rootSkill": { "type": ["string", "null"] },
            "guardrails": string_array_schema()
        }
    })
}

fn auth_import_input_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["user", "tokens"],
        "properties": {
            "user": {
                "type": "object",
                "additionalProperties": false,
                "required": ["id", "email"],
                "properties": {
                    "id": { "type": "string", "minLength": 1 },
                    "email": { "type": "string", "format": "email", "minLength": 1 },
                    "display_name": { "type": ["string", "null"] }
                }
            },
            "tokens": {
                "type": "object",
                "additionalProperties": false,
                "required": ["access_token"],
                "properties": {
                    "access_token": { "type": "string", "minLength": 1 },
                    "issued_at": { "type": ["string", "null"], "format": "date-time" },
                    "expires_at": { "type": ["string", "null"], "format": "date-time" }
                }
            },
            "last_refresh": { "type": ["string", "null"], "format": "date-time" }
        }
    })
}

fn auth_none() -> AuthRequirements {
    AuthRequirements {
        authenticated: false,
        modes: vec!["none".to_owned()],
        org_scoped: false,
    }
}

fn auth_session() -> AuthRequirements {
    AuthRequirements {
        authenticated: true,
        modes: vec!["session_cookie".to_owned(), "bearer_token".to_owned()],
        org_scoped: false,
    }
}
