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
//!     "oneq org list",
//!     ErrorStage::Auth,
//!     "no stored OneQuery token was found.",
//!     vec!["oneq auth login".to_owned()],
//! );
//!
//! assert_eq!(error.exit_code(), 3);
//! assert_eq!(error.stage, ErrorStage::Auth);
//! ```

/// Shared CLI error types and helpers.
pub mod error;
