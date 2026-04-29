use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::io::Write;
use std::path::Path;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::lifecycle_records;

pub(super) fn next_lifecycle_event_sequence(
    path: &Path,
    command_line: &str,
    read_try_next: Vec<String>,
    parse_try_next: Vec<String>,
) -> Result<u64, CliError> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(1),
        Err(error) => {
            return Err(CliError::new(
                "failed to read lifecycle event log",
                command_line,
                ErrorStage::Internal,
                format!("{error} ({})", path.display()),
                read_try_next,
            ));
        }
    };

    if contents.is_empty() {
        return Ok(1);
    }

    let entries =
        lifecycle_records::decode_lifecycle_event_log_entries(&contents).map_err(|error| {
            CliError::new(
                "failed to parse lifecycle event log",
                command_line,
                ErrorStage::Internal,
                format!(
                    "{error} ({}, encoding={})",
                    path.display(),
                    lifecycle_records::durable_lifecycle_record_encoding_label(
                        lifecycle_records::DURABLE_EVENT_LOG_ENCODING
                    )
                ),
                parse_try_next,
            )
        })?;

    Ok(entries
        .into_iter()
        .filter_map(|entry| entry.lifecycle_sequence)
        .max()
        .unwrap_or(0)
        .saturating_add(1))
}

pub(super) fn append_private_lifecycle_event_log_frame(
    path: &Path,
    frame: &[u8],
    command_line: &str,
    try_next: Vec<String>,
) -> Result<(), CliError> {
    let parent = path.parent().ok_or_else(|| {
        CliError::new(
            "failed to compute lifecycle event log directory",
            command_line,
            ErrorStage::Internal,
            format!("invalid path: {}", path.display()),
            try_next.clone(),
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        CliError::new(
            "failed to create lifecycle event log directory",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", parent.display()),
            try_next.clone(),
        )
    })?;

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = options.open(path).map_err(|error| {
        CliError::new(
            "failed to open lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            try_next.clone(),
        )
    })?;

    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
        CliError::new(
            "failed to secure lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            try_next.clone(),
        )
    })?;

    file.write_all(frame).map_err(|error| {
        CliError::new(
            "failed to append lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            try_next.clone(),
        )
    })?;
    file.sync_all().map_err(|error| {
        CliError::new(
            "failed to sync lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            try_next,
        )
    })
}

pub(super) fn protobuf_timestamp(
    value: chrono::DateTime<chrono::Utc>,
) -> buffa_types::google::protobuf::Timestamp {
    buffa_types::google::protobuf::Timestamp {
        seconds: value.timestamp(),
        nanos: value.timestamp_subsec_nanos() as i32,
        ..Default::default()
    }
}
