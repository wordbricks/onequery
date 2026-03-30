pub mod codex_app_server;

use crate::error::WtlError;
use crate::observer::Observer;
use crate::policy::ExecutionPlan;

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct TurnFailure {
    pub message: String,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum TurnOutcome {
    Success { response: String },
    Failure(TurnFailure),
}

#[allow(async_fn_in_trait)]
pub trait TurnRuntime {
    async fn start_session(&mut self, developer_instructions: &str) -> Result<String, WtlError>;

    async fn run_turn<O>(
        &mut self,
        thread_id: &str,
        plan: &ExecutionPlan,
        observer: &mut O,
    ) -> Result<TurnOutcome, WtlError>
    where
        O: Observer;

    async fn shutdown(&mut self) -> Result<(), WtlError>;
}
