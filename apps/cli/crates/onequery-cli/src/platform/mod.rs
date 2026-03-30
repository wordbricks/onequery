//! Explicit platform adapters for OS-coupled CLI behavior.
//!
//! Reducers and command workflows talk to these adapters through
//! [`crate::commands::Runtime`] so browser launch and terminal output stay
//! outside workflow logic.
//!
//! The app workflow borrows these adapters through a single `Runtime` value;
//! nothing in the current command path shares them across spawned tasks.
//!
//! Shell execution, subprocess management, PTYs, and sandboxing are
//! intentionally absent until the CLI has a real command-execution feature
//! that needs them. If OS-specific behavior ever diverges further, keep that
//! branching inside this module instead of reducers or command handlers.

mod browser;
mod terminal;

#[cfg(test)]
pub(crate) use browser::BrowserLaunchError;
pub(crate) use browser::BrowserLauncher;
pub(crate) use browser::SystemBrowserLauncher;
pub(crate) use terminal::StderrTerminal;
pub(crate) use terminal::Terminal;

#[derive(Debug)]
pub(crate) struct PlatformAdapters<B = SystemBrowserLauncher, T = StderrTerminal> {
    pub(crate) browser: B,
    pub(crate) terminal: T,
}

impl PlatformAdapters<SystemBrowserLauncher, StderrTerminal> {
    pub(crate) fn system() -> Self {
        Self {
            browser: SystemBrowserLauncher,
            terminal: StderrTerminal,
        }
    }
}
