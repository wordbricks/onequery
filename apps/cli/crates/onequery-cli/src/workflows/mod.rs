//! Shared reducer workflow primitives for the CLI.
//!
//! `runner` is the only place that drives the reducer -> effect -> event loop.
//! Command modules should model workflow state locally and delegate execution to
//! that runner instead of introducing ad hoc async orchestration paths.

pub(crate) mod app;
pub(crate) mod login_poll;
pub(crate) mod retry;
pub(crate) mod runner;
