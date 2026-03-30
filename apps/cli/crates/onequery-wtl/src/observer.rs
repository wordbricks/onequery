use std::io::Write;

use crate::error::WtlError;

pub trait Observer {
    fn on_run_started(&mut self) -> Result<(), WtlError>;
    fn on_turn_started(&mut self, turn_number: usize) -> Result<(), WtlError>;
    fn on_turn_delta(&mut self, delta: &str) -> Result<(), WtlError>;
    fn on_turn_finished(&mut self) -> Result<(), WtlError>;
    fn on_run_completed(&mut self) -> Result<(), WtlError>;
    fn on_run_exhausted(&mut self, message: &str) -> Result<(), WtlError>;
    fn on_run_interrupted(&mut self) -> Result<(), WtlError>;
}

#[derive(Debug)]
pub struct CliObserver<W> {
    writer: W,
    turn_stream_open: bool,
    turn_ended_with_newline: bool,
}

impl<W> CliObserver<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            turn_stream_open: false,
            turn_ended_with_newline: true,
        }
    }
}

impl<W> CliObserver<W>
where
    W: Write,
{
    pub fn into_inner(self) -> W {
        self.writer
    }

    fn write_line(&mut self, line: &str) -> Result<(), WtlError> {
        writeln!(self.writer, "{line}").map_err(WtlError::ObserverIo)
    }

    fn close_turn_stream_if_needed(&mut self) -> Result<(), WtlError> {
        if self.turn_stream_open && !self.turn_ended_with_newline {
            writeln!(self.writer).map_err(WtlError::ObserverIo)?;
        }
        self.turn_stream_open = false;
        self.turn_ended_with_newline = true;
        Ok(())
    }
}

impl<W> Observer for CliObserver<W>
where
    W: Write,
{
    fn on_run_started(&mut self) -> Result<(), WtlError> {
        Ok(())
    }

    fn on_turn_started(&mut self, turn_number: usize) -> Result<(), WtlError> {
        self.close_turn_stream_if_needed()?;
        self.write_line(&format!("[turn {turn_number}] running..."))
    }

    fn on_turn_delta(&mut self, delta: &str) -> Result<(), WtlError> {
        self.turn_stream_open = true;
        self.turn_ended_with_newline = delta.ends_with('\n');
        write!(self.writer, "{delta}").map_err(WtlError::ObserverIo)
    }

    fn on_turn_finished(&mut self) -> Result<(), WtlError> {
        self.close_turn_stream_if_needed()
    }

    fn on_run_completed(&mut self) -> Result<(), WtlError> {
        self.close_turn_stream_if_needed()?;
        self.write_line("Done: your request was completed successfully.")
    }

    fn on_run_exhausted(&mut self, message: &str) -> Result<(), WtlError> {
        self.close_turn_stream_if_needed()?;
        self.write_line(message)
    }

    fn on_run_interrupted(&mut self) -> Result<(), WtlError> {
        self.close_turn_stream_if_needed()?;
        self.write_line("Stopped: user interrupt.")
    }
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;

    use super::CliObserver;
    use super::Observer;

    #[test]
    fn transcript_snapshot_streams_turn_output() {
        let mut observer = CliObserver::new(Vec::new());

        observer.on_run_started().expect("expected run start");
        observer.on_turn_started(1).expect("expected turn start");
        observer.on_turn_delta("hello ").expect("expected delta");
        observer
            .on_turn_delta("##WTL_DONE##")
            .expect("expected second delta");
        observer.on_turn_finished().expect("expected turn finish");
        observer.on_run_completed().expect("expected completion");

        let rendered =
            String::from_utf8(observer.into_inner()).expect("expected valid UTF-8 transcript");

        assert_snapshot!(rendered);
    }
}
