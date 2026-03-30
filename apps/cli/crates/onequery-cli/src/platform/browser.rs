use thiserror::Error;

pub(crate) trait BrowserLauncher: std::fmt::Debug {
    fn open_url(&self, url: &str) -> Result<(), BrowserLaunchError>;
}

#[derive(Debug, Clone, Eq, PartialEq, Error)]
pub(crate) enum BrowserLaunchError {
    #[error("{message}")]
    Open { message: String },
}

#[derive(Debug)]
pub(crate) struct SystemBrowserLauncher;

impl BrowserLauncher for SystemBrowserLauncher {
    fn open_url(&self, url: &str) -> Result<(), BrowserLaunchError> {
        // CONTEXT: if Windows-specific launch behavior grows later, keep that
        // branching here instead of in reducers or command handlers.
        webbrowser::open(url)
            .map(|_| ())
            .map_err(|open_error| BrowserLaunchError::Open {
                message: open_error.to_string(),
            })
    }
}
