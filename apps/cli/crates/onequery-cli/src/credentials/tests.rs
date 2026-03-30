use std::fs;

use pretty_assertions::assert_eq;
use uuid::Uuid;

use super::AuthDotJson;
use super::AuthSessionMetadata;
use super::AuthSessionSnapshot;
use super::AuthSessionSource;
use super::AuthSessionStore;
use super::ImportedAuthSession;
use super::backends::read_persisted_auth_session_record;
use crate::transport::auth::LoginCompletion;
use crate::transport::auth::UserProfile;

fn sample_login_completion(access_token: &str, email: &str) -> LoginCompletion {
    LoginCompletion {
        access_token: access_token.to_owned(),
        auth_mode: None,
        user: UserProfile {
            id: "user-1".to_owned(),
            email: email.to_owned(),
            display_name: "Alice".to_owned(),
        },
        issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
        expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
    }
}

#[test]
fn file_storage_load_returns_none_when_auth_file_is_missing() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });
    let auth_path = test_dir.join("auth.json");

    let snapshot = read_persisted_auth_session_record(&auth_path, "oneq auth whoami")
        .unwrap_or_else(|error| panic!("expected missing auth file load to succeed: {error}"));

    assert_eq!(snapshot, None);

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn file_storage_reports_parse_errors_for_malformed_auth_json() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });
    let auth_path = test_dir.join("auth.json");
    fs::write(&auth_path, "{not-json").unwrap_or_else(|error| {
        panic!("expected malformed auth file write to succeed: {error}");
    });

    let error = read_persisted_auth_session_record(&auth_path, "oneq auth whoami")
        .expect_err("expected malformed auth file parse to fail");

    assert_eq!(error.title, "failed to parse auth file");

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn file_storage_persist_preserves_in_memory_state_when_write_fails() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    let invalid_auth_path = test_dir.join("auth-target");
    fs::create_dir_all(&invalid_auth_path).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });

    let mut store = AuthSessionStore::with_file_access_token_for_test(
        invalid_auth_path.clone(),
        Some("access_token_old".to_owned()),
    );

    let error = store
        .persist_login_completion(
            &sample_login_completion("access_token_new", "alice@example.com"),
            "oneq auth login",
        )
        .expect_err("expected auth persistence failure");

    assert_eq!(
        (error.title.clone(), store),
        (
            "failed to finalize auth file".to_owned(),
            AuthSessionStore::with_file_access_token_for_test(
                invalid_auth_path,
                Some("access_token_old".to_owned()),
            ),
        )
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn file_storage_clear_preserves_in_memory_state_when_delete_fails() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    let invalid_auth_path = test_dir.join("auth-target");
    fs::create_dir_all(&invalid_auth_path).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });

    let mut store = AuthSessionStore::with_file_access_token_for_test(
        invalid_auth_path.clone(),
        Some("access_token_old".to_owned()),
    );

    let error = store
        .clear_session("oneq auth logout")
        .expect_err("expected auth delete failure");

    assert_eq!(
        (error.title.clone(), store),
        (
            "failed to remove auth file".to_owned(),
            AuthSessionStore::with_file_access_token_for_test(
                invalid_auth_path,
                Some("access_token_old".to_owned()),
            ),
        )
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn file_storage_clear_removes_persisted_state_and_in_memory_state() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });
    let auth_path = test_dir.join("auth.json");
    let serialized = serde_json::to_string_pretty(&AuthDotJson {
        user: None,
        tokens: Some(super::PersistedAuthTokens {
            access_token: "pat_file".to_owned(),
            issued_at: None,
            expires_at: None,
        }),
        last_refresh: Some("2026-03-10T00:00:00Z".to_owned()),
    })
    .unwrap_or_else(|error| panic!("expected auth serialization to succeed: {error}"));
    fs::write(&auth_path, serialized)
        .unwrap_or_else(|error| panic!("expected auth file write to succeed: {error}"));

    let mut store = AuthSessionStore::with_file_access_token_for_test(
        auth_path.clone(),
        Some("pat_file".to_owned()),
    );

    store
        .clear_session("oneq auth logout")
        .unwrap_or_else(|error| panic!("expected file clear to succeed: {error}"));

    assert_eq!(
        (store, auth_path.exists()),
        (
            AuthSessionStore::with_file_access_token_for_test(auth_path.clone(), None),
            false,
        )
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn file_storage_loads_current_auth_json_shape() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });
    let auth_path = test_dir.join("auth.json");
    let serialized = serde_json::to_string_pretty(&AuthDotJson {
        user: Some(super::PersistedAuthUser {
            id: "user-1".to_owned(),
            email: "alice@example.com".to_owned(),
            display_name: Some("Alice".to_owned()),
        }),
        tokens: Some(super::PersistedAuthTokens {
            access_token: "pat_file".to_owned(),
            issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
            expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
        }),
        last_refresh: Some("2026-03-10T00:00:00Z".to_owned()),
    })
    .unwrap_or_else(|error| panic!("expected auth serialization to succeed: {error}"));
    fs::write(&auth_path, serialized)
        .unwrap_or_else(|error| panic!("expected auth file write to succeed: {error}"));

    let snapshot = read_persisted_auth_session_record(&auth_path, "oneq auth whoami")
        .unwrap_or_else(|error| panic!("expected auth load to succeed: {error}"))
        .expect("expected persisted auth record");
    let snapshot = AuthSessionSnapshot::from_auth_json(snapshot);

    assert_eq!(
        snapshot,
        AuthSessionSnapshot {
            access_token: Some("pat_file".to_owned()),
            metadata: AuthSessionMetadata {
                principal: Some(super::AuthSessionPrincipal {
                    user_id: "user-1".to_owned(),
                    email: "alice@example.com".to_owned(),
                }),
                display_name: Some("Alice".to_owned()),
                issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
                expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
                last_refresh: Some("2026-03-10T00:00:00Z".to_owned()),
            },
        }
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn import_payload_parses_current_auth_json_shape() {
    let raw = serde_json::to_string_pretty(&AuthDotJson {
        user: Some(super::PersistedAuthUser {
            id: "user-1".to_owned(),
            email: "alice@example.com".to_owned(),
            display_name: Some("Alice".to_owned()),
        }),
        tokens: Some(super::PersistedAuthTokens {
            access_token: "pat_file".to_owned(),
            issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
            expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
        }),
        last_refresh: Some("2026-03-10T00:00:00Z".to_owned()),
    })
    .unwrap_or_else(|error| panic!("expected auth serialization to succeed: {error}"));

    let imported = ImportedAuthSession::from_raw_json(&raw, "oneq auth import --input -")
        .unwrap_or_else(|error| panic!("expected auth import parse to succeed: {error}"));

    assert_eq!(
        imported,
        ImportedAuthSession {
            user_id: "user-1".to_owned(),
            email: "alice@example.com".to_owned(),
            display_name: Some("Alice".to_owned()),
            access_token: "pat_file".to_owned(),
            issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
            expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
            last_refresh: Some("2026-03-10T00:00:00Z".to_owned()),
        }
    );
}

#[test]
fn import_payload_rejects_missing_user_identity() {
    let raw = serde_json::to_string_pretty(&AuthDotJson {
        user: None,
        tokens: Some(super::PersistedAuthTokens {
            access_token: "pat_file".to_owned(),
            issued_at: None,
            expires_at: None,
        }),
        last_refresh: None,
    })
    .unwrap_or_else(|error| panic!("expected auth serialization to succeed: {error}"));

    let error = ImportedAuthSession::from_raw_json(&raw, "oneq auth import --input -")
        .expect_err("expected auth import to reject payloads without user identity");

    assert_eq!(error.title, "invalid auth import payload");
}

#[test]
fn file_storage_persist_records_user_and_session_metadata() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });
    let auth_path = test_dir.join("auth.json");

    let mut store = AuthSessionStore::with_file_access_token_for_test(auth_path.clone(), None);
    store
        .persist_login_completion(
            &sample_login_completion("pat_file", "alice@example.com"),
            "oneq auth login",
        )
        .unwrap_or_else(|error| panic!("expected auth persistence to succeed: {error}"));

    let serialized = fs::read_to_string(&auth_path)
        .unwrap_or_else(|error| panic!("expected auth file read to succeed: {error}"));
    let record = serde_json::from_str::<AuthDotJson>(&serialized)
        .unwrap_or_else(|error| panic!("expected auth file parse to succeed: {error}"));
    let last_refresh = record.last_refresh.clone();

    assert_eq!(
        (record, store),
        (
            AuthDotJson {
                user: Some(super::PersistedAuthUser {
                    id: "user-1".to_owned(),
                    email: "alice@example.com".to_owned(),
                    display_name: Some("Alice".to_owned()),
                }),
                tokens: Some(super::PersistedAuthTokens {
                    access_token: "pat_file".to_owned(),
                    issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
                    expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
                }),
                last_refresh: last_refresh.clone(),
            },
            AuthSessionStore {
                snapshot: AuthSessionSnapshot {
                    access_token: Some("pat_file".to_owned()),
                    metadata: AuthSessionMetadata {
                        principal: Some(super::AuthSessionPrincipal {
                            user_id: "user-1".to_owned(),
                            email: "alice@example.com".to_owned(),
                        }),
                        display_name: Some("Alice".to_owned()),
                        issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
                        expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
                        last_refresh,
                    },
                },
                path: auth_path,
                source: AuthSessionSource::PersistedFile,
            },
        )
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}

#[test]
fn file_storage_persist_imported_session_preserves_import_metadata() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected temp auth directory creation to succeed: {error}");
    });
    let auth_path = test_dir.join("auth.json");

    let imported = ImportedAuthSession {
        user_id: "user-2".to_owned(),
        email: "bob@example.com".to_owned(),
        display_name: None,
        access_token: "pat_imported".to_owned(),
        issued_at: Some("2026-03-11T00:00:00.000Z".to_owned()),
        expires_at: Some("2026-03-18T00:00:00.000Z".to_owned()),
        last_refresh: Some("2026-03-11T12:00:00Z".to_owned()),
    };

    let mut store = AuthSessionStore::with_file_access_token_for_test(auth_path.clone(), None);
    store
        .persist_imported_session(&imported, "oneq auth import --input auth.json")
        .unwrap_or_else(|error| panic!("expected auth import persistence to succeed: {error}"));

    let serialized = fs::read_to_string(&auth_path)
        .unwrap_or_else(|error| panic!("expected auth file read to succeed: {error}"));
    let record = serde_json::from_str::<AuthDotJson>(&serialized)
        .unwrap_or_else(|error| panic!("expected auth file parse to succeed: {error}"));

    assert_eq!(
        record,
        AuthDotJson {
            user: Some(super::PersistedAuthUser {
                id: "user-2".to_owned(),
                email: "bob@example.com".to_owned(),
                display_name: None,
            }),
            tokens: Some(super::PersistedAuthTokens {
                access_token: "pat_imported".to_owned(),
                issued_at: Some("2026-03-11T00:00:00.000Z".to_owned()),
                expires_at: Some("2026-03-18T00:00:00.000Z".to_owned()),
            }),
            last_refresh: Some("2026-03-11T12:00:00Z".to_owned()),
        }
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected temp auth directory cleanup to succeed: {cleanup_error}");
    });
}
