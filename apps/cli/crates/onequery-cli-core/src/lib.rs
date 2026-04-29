#![warn(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]
//! Shared core types for the OneQuery CLI.
//!
//! # Examples
//!
//! ```
//! use onequery_cli_core::error::{CliError, ErrorStage};
//!
//! let error = CliError::new(
//!     "not logged in",
//!     "onequery org list",
//!     ErrorStage::Auth,
//!     "no stored OneQuery token was found.",
//!     vec!["onequery auth login".to_owned()],
//! );
//!
//! assert_eq!(error.exit_code(), 3);
//! assert_eq!(error.stage, ErrorStage::Auth);
//! ```

/// Shared application config/data path resolution.
pub mod app_paths;
/// Shared CLI error types and helpers.
pub mod error;
/// Shared packaged runtime bundle layout helpers.
pub mod packaged_runtime;
/// Shared path normalization and atomic file helpers.
pub mod path_utils;
/// Shared process inspection helpers.
pub mod process;
/// Captured process context used by commands that need current executable metadata.
pub mod process_context;
