//! Reducer workflow execution primitives.
//!
//! This module is the CLI's single reducer/effect execution boundary:
//! reducers emit a `Transition`, effects run asynchronously outside reducer
//! code, and the emitted event is fed back into the reducer loop.

use std::fmt::Debug;
use std::future::Future;
use std::pin::Pin;

use onequery_cli_core::error::CliError;

pub(crate) trait WorkflowLabel {
    fn workflow_label(&self) -> &'static str;
}

#[derive(Debug)]
enum TransitionKind<S, T, F> {
    Continue { next_state: S, effect: F },
    Done { terminal_state: T },
}

#[must_use]
#[derive(Debug)]
pub(crate) enum TransitionProgress<S, T, F> {
    Continue { next_state: S, effect: F },
    Done { terminal_state: T },
}

#[must_use]
#[derive(Debug)]
pub(crate) struct Transition<S, T, F> {
    kind: TransitionKind<S, T, F>,
}

impl<S, T, F> Transition<S, T, F> {
    pub(crate) fn continue_with_effect(next_state: S, effect: F) -> Self {
        Self {
            kind: TransitionKind::Continue { next_state, effect },
        }
    }

    pub(crate) fn done(terminal_state: T) -> Self {
        Self {
            kind: TransitionKind::Done { terminal_state },
        }
    }

    pub(crate) fn next_state(&self) -> Option<&S> {
        match &self.kind {
            TransitionKind::Continue { next_state, .. } => Some(next_state),
            TransitionKind::Done { .. } => None,
        }
    }

    pub(crate) fn terminal_state(&self) -> Option<&T> {
        match &self.kind {
            TransitionKind::Continue { .. } => None,
            TransitionKind::Done { terminal_state } => Some(terminal_state),
        }
    }

    pub(crate) fn into_progress(self) -> TransitionProgress<S, T, F> {
        match self.kind {
            TransitionKind::Continue { next_state, effect } => {
                TransitionProgress::Continue { next_state, effect }
            }
            TransitionKind::Done { terminal_state } => TransitionProgress::Done { terminal_state },
        }
    }
}

pub(crate) const DEFAULT_MAX_WORKFLOW_STEPS: usize = 1_024;

type WorkflowEffectFuture<'a, E> = Pin<Box<dyn Future<Output = E> + 'a>>;

pub(crate) struct WorkflowRunConfig<'a, Ctx, Rt> {
    pub context: &'a Ctx,
    pub runtime: &'a mut Rt,
    pub workflow_name: &'a str,
    pub command_line: &'a str,
    pub verbose: bool,
    pub max_steps: usize,
}

pub(crate) async fn run_reducer_workflow<S, E, T, F, Ctx, Rt, Reduce, ExecuteEffect>(
    initial_state: S,
    initial_event: E,
    config: WorkflowRunConfig<'_, Ctx, Rt>,
    mut reduce: Reduce,
    mut execute_effect: ExecuteEffect,
) -> Result<T, CliError>
where
    S: Debug + WorkflowLabel,
    E: Debug + WorkflowLabel,
    T: Debug + WorkflowLabel,
    F: Debug + WorkflowLabel,
    Reduce: FnMut(S, E, &Ctx) -> Transition<S, T, F>,
    // CONTEXT: stable Rust cannot express a borrowed async `FnMut` here without either boxing
    // the future or introducing executor structs/GAT-heavy adapters at each workflow call site.
    // These workflows are network/IO-bound, so the boxed future keeps the runner readable while
    // preserving the reducer/effect boundary.
    ExecuteEffect: for<'a> FnMut(F, &'a Ctx, &'a mut Rt) -> WorkflowEffectFuture<'a, E>,
{
    // Reducers stay pure by returning the next state plus an effect token.
    // Only this loop is allowed to execute the deferred effect and feed the
    // resulting event back into the state machine.
    let mut state = initial_state;
    let mut event = initial_event;
    let mut step = 0_usize;

    loop {
        if step >= config.max_steps {
            return Err(CliError::internal(
                config.command_line.to_owned(),
                format!(
                    "{workflow_name} workflow exceeded max step count ({max_steps}) without reaching terminal state",
                    workflow_name = config.workflow_name,
                    max_steps = config.max_steps,
                ),
            ));
        }
        step += 1;

        if config.verbose {
            tracing::info!(
                workflow = config.workflow_name,
                step,
                state_before = state.workflow_label(),
                event = event.workflow_label(),
                "workflow reduce",
            );
        }

        let transition = reduce(state, event, config.context);

        if config.verbose {
            tracing::info!(
                workflow = config.workflow_name,
                step,
                state_after = ?transition.next_state().map(WorkflowLabel::workflow_label),
                terminal_state = ?transition.terminal_state().map(WorkflowLabel::workflow_label),
                "workflow transition",
            );
        }

        match transition.into_progress() {
            TransitionProgress::Continue { next_state, effect } => {
                state = next_state;
                if config.verbose {
                    tracing::info!(
                        workflow = config.workflow_name,
                        step,
                        effect = effect.workflow_label(),
                        "workflow effect dispatch"
                    );
                }

                event = execute_effect(effect, config.context, config.runtime).await;

                if config.verbose {
                    tracing::info!(
                        workflow = config.workflow_name,
                        step,
                        event = event.workflow_label(),
                        "workflow effect emitted event"
                    );
                }
            }
            TransitionProgress::Done { terminal_state } => return Ok(terminal_state),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::sync::Arc;
    use std::sync::Mutex;

    use pretty_assertions::assert_eq;
    use tracing_subscriber::EnvFilter;
    use tracing_subscriber::fmt::MakeWriter;

    use super::Transition;
    use super::WorkflowLabel;
    use super::WorkflowRunConfig;
    use super::run_reducer_workflow;

    #[derive(Debug)]
    enum TestState {
        Idle,
        Running,
    }

    #[derive(Debug)]
    enum TestTerminalState {
        Completed,
    }

    #[derive(Debug)]
    enum TestEvent {
        Start,
        SideEffectFinished,
    }

    #[derive(Debug)]
    enum TestEffect {
        EmitSideEffectEvent,
    }

    #[derive(Debug)]
    enum SecretState {
        Idle { pat: String },
        Running { sql: String },
    }

    #[derive(Debug)]
    enum SecretTerminalState {
        Completed,
    }

    #[derive(Debug)]
    enum SecretEvent {
        Start { sql: String },
        SecretObserved { pat: String },
    }

    #[derive(Debug)]
    enum SecretEffect {
        EmitSecret { pat: String },
    }

    #[derive(Clone, Default)]
    struct SharedLogWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    struct SharedLogHandle {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl SharedLogWriter {
        fn contents(&self) -> String {
            String::from_utf8(self.buffer.lock().expect("lock log buffer").clone())
                .expect("log output should be valid UTF-8")
        }
    }

    impl<'a> MakeWriter<'a> for SharedLogWriter {
        type Writer = SharedLogHandle;

        fn make_writer(&'a self) -> Self::Writer {
            SharedLogHandle {
                buffer: Arc::clone(&self.buffer),
            }
        }
    }

    impl io::Write for SharedLogHandle {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.buffer
                .lock()
                .expect("lock log buffer")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl WorkflowLabel for TestState {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::Idle => "Idle",
                Self::Running => "Running",
            }
        }
    }

    impl WorkflowLabel for TestTerminalState {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::Completed => "Completed",
            }
        }
    }

    impl WorkflowLabel for TestEvent {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::Start => "Start",
                Self::SideEffectFinished => "SideEffectFinished",
            }
        }
    }

    impl WorkflowLabel for TestEffect {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::EmitSideEffectEvent => "EmitSideEffectEvent",
            }
        }
    }

    impl WorkflowLabel for SecretState {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::Idle { .. } => "Idle",
                Self::Running { .. } => "Running",
            }
        }
    }

    impl WorkflowLabel for SecretTerminalState {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::Completed => "Completed",
            }
        }
    }

    impl WorkflowLabel for SecretEvent {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::Start { .. } => "Start",
                Self::SecretObserved { .. } => "SecretObserved",
            }
        }
    }

    impl WorkflowLabel for SecretEffect {
        fn workflow_label(&self) -> &'static str {
            match self {
                Self::EmitSecret { .. } => "EmitSecret",
            }
        }
    }

    #[tokio::test]
    async fn non_terminating_workflow_returns_internal_error_when_max_steps_exceeded() {
        let mut runtime = ();
        let context = ();

        let result = run_reducer_workflow(
            TestState::Idle,
            TestEvent::Start,
            WorkflowRunConfig {
                context: &context,
                runtime: &mut runtime,
                workflow_name: "test",
                command_line: "onequery test",
                verbose: false,
                max_steps: 2,
            },
            |state, event, _| match (state, event) {
                (TestState::Idle, TestEvent::Start) => Transition::continue_with_effect(
                    TestState::Running,
                    TestEffect::EmitSideEffectEvent,
                ),
                (TestState::Running, TestEvent::SideEffectFinished) => {
                    Transition::continue_with_effect(
                        TestState::Running,
                        TestEffect::EmitSideEffectEvent,
                    )
                }
                (TestState::Idle, TestEvent::SideEffectFinished)
                | (TestState::Running, TestEvent::Start) => {
                    Transition::done(TestTerminalState::Completed)
                }
            },
            |effect, _, _| {
                Box::pin(async move {
                    match effect {
                        TestEffect::EmitSideEffectEvent => TestEvent::SideEffectFinished,
                    }
                })
            },
        )
        .await;

        let error = result.expect_err("expected max-step failure");
        assert_eq!(
            (error.stage, error.why.clone()),
            (
                onequery_cli_core::error::ErrorStage::Internal,
                "test workflow exceeded max step count (2) without reaching terminal state"
                    .to_owned(),
            )
        );
    }

    #[tokio::test]
    async fn continue_then_done_returns_terminal_state() {
        let mut runtime = ();
        let context = ();

        let result = run_reducer_workflow(
            TestState::Idle,
            TestEvent::Start,
            WorkflowRunConfig {
                context: &context,
                runtime: &mut runtime,
                workflow_name: "test",
                command_line: "onequery test",
                verbose: false,
                max_steps: 8,
            },
            |state, event, _| match (state, event) {
                (TestState::Idle, TestEvent::Start) => Transition::continue_with_effect(
                    TestState::Running,
                    TestEffect::EmitSideEffectEvent,
                ),
                (TestState::Running, TestEvent::SideEffectFinished) => {
                    Transition::done(TestTerminalState::Completed)
                }
                (TestState::Idle, TestEvent::SideEffectFinished)
                | (TestState::Running, TestEvent::Start) => {
                    Transition::done(TestTerminalState::Completed)
                }
            },
            |effect, _, _| {
                Box::pin(async move {
                    match effect {
                        TestEffect::EmitSideEffectEvent => TestEvent::SideEffectFinished,
                    }
                })
            },
        )
        .await;

        let terminal_state = result.expect("expected terminal state");
        assert!(matches!(terminal_state, TestTerminalState::Completed));
    }

    #[tokio::test(flavor = "current_thread")]
    #[expect(
        clippy::await_holding_lock,
        reason = "the tracing subscriber lock must remain held for the full async log capture"
    )]
    async fn verbose_logging_uses_labels_instead_of_debug_payloads() {
        let _subscriber_lock = crate::test_support::lock_tracing_subscriber();
        let mut runtime = ();
        let context = ();
        let log_writer = SharedLogWriter::default();
        let subscriber = tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::new("info"))
            .with_ansi(false)
            .without_time()
            .with_writer(log_writer.clone())
            .finish();
        let _guard = tracing::subscriber::set_default(subscriber);
        tracing::callsite::rebuild_interest_cache();

        let result = run_reducer_workflow(
            SecretState::Idle {
                pat: "pat_secret_123".to_owned(),
            },
            SecretEvent::Start {
                sql: "select * from payroll".to_owned(),
            },
            WorkflowRunConfig {
                context: &context,
                runtime: &mut runtime,
                workflow_name: "secret_test",
                command_line: "onequery secret-test",
                verbose: true,
                max_steps: 4,
            },
            |state, event, _| match (state, event) {
                (SecretState::Idle { pat }, SecretEvent::Start { sql }) => {
                    Transition::continue_with_effect(
                        SecretState::Running { sql },
                        SecretEffect::EmitSecret { pat },
                    )
                }
                (SecretState::Running { sql }, SecretEvent::SecretObserved { pat }) => {
                    assert_eq!(sql, "select * from payroll");
                    assert_eq!(pat, "pat_secret_123");
                    Transition::done(SecretTerminalState::Completed)
                }
                (SecretState::Idle { .. }, SecretEvent::SecretObserved { .. })
                | (SecretState::Running { .. }, SecretEvent::Start { .. }) => {
                    Transition::done(SecretTerminalState::Completed)
                }
            },
            |effect, _, _| {
                Box::pin(async move {
                    match effect {
                        SecretEffect::EmitSecret { pat } => SecretEvent::SecretObserved { pat },
                    }
                })
            },
        )
        .await;

        let terminal_state = result.expect("expected terminal state");
        let logs = log_writer.contents();
        assert_eq!(
            (
                matches!(terminal_state, SecretTerminalState::Completed),
                logs.contains("workflow reduce"),
                logs.contains("workflow effect dispatch"),
                logs.contains("workflow effect emitted event"),
                logs.contains("Idle"),
                logs.contains("EmitSecret"),
                logs.contains("SecretObserved"),
                logs.contains("pat_secret_123"),
                logs.contains("select * from payroll"),
            ),
            (true, true, true, true, true, true, true, false, false)
        );
    }
}
