pub(crate) trait Terminal: std::fmt::Debug {
    fn stderr_line(&self, message: &str);
}

#[derive(Debug)]
pub(crate) struct StderrTerminal;

impl Terminal for StderrTerminal {
    fn stderr_line(&self, message: &str) {
        eprintln!("{message}");
    }
}
