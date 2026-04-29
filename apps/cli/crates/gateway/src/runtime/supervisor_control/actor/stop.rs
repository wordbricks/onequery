use tokio::sync::oneshot;

use crate::supervisor_control_proto::types;

use super::super::errors::failed_precondition;
use super::SupervisorControlActor;

pub(crate) struct SupervisorStopRequest {
    operation_id: String,
    response_tx: oneshot::Sender<
        Result<types::SupervisorLifecycleServiceStopResponse, connectrpc::ConnectError>,
    >,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SupervisorStopOperation {
    pub(super) operation_id: String,
}
impl SupervisorControlActor {
    pub(crate) async fn send_stop_command(
        &self,
        command: types::SupervisorStopCommand,
    ) -> Result<types::SupervisorStatus, connectrpc::ConnectError> {
        let tx = self
            .state
            .command_sink
            .read()
            .await
            .as_ref()
            .map(|sink| sink.tx.clone())
            .ok_or_else(|| {
                connectrpc::ConnectError::unavailable(
                    "supervisor control stop command stream is not attached",
                )
            })?;

        tx.send(types::OpenRuntimeSessionResponse {
            response: Some(types::open_runtime_session_response::Response::Stop(
                Box::new(command),
            )),
            ..Default::default()
        })
        .await
        .map_err(|_| {
            connectrpc::ConnectError::unavailable(
                "supervisor control stop command stream is not attached",
            )
        })?;

        Ok(self.snapshot().await)
    }

    pub(crate) async fn request_stop(
        &self,
        operation_id: String,
    ) -> Result<types::SupervisorLifecycleServiceStopResponse, connectrpc::ConnectError> {
        {
            let mut current_stop = self.state.current_stop.lock().await;
            if current_stop.is_some() {
                return Ok(stop_response(
                    types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING,
                    self.snapshot().await,
                ));
            }

            *current_stop = Some(SupervisorStopOperation {
                operation_id: operation_id.clone(),
            });
        }

        let (response_tx, response_rx) = oneshot::channel();
        self.state
            .stop_requests_tx
            .send(SupervisorStopRequest {
                operation_id,
                response_tx,
            })
            .await
            .map_err(|_| failed_precondition("supervisor control stop monitor is not attached"))?;

        response_rx
            .await
            .map_err(|_| failed_precondition("supervisor control stop monitor closed"))?
    }

    pub(crate) async fn recv_stop_request(&self) -> Option<SupervisorStopRequest> {
        self.state.stop_requests_rx.lock().await.recv().await
    }

    pub(super) async fn clear_current_stop(&self) {
        *self.state.current_stop.lock().await = None;
    }

    pub(super) async fn validate_current_stop_operation_id(
        &self,
        operation_id: Option<&str>,
        field: &str,
    ) -> Result<(), connectrpc::ConnectError> {
        let current_stop = self.state.current_stop.lock().await;
        let Some(current_stop) = current_stop.as_ref() else {
            return Ok(());
        };
        let Some(operation_id) = operation_id else {
            return Ok(());
        };
        if current_stop.operation_id == operation_id {
            return Ok(());
        }

        Err(failed_precondition(format!(
            "{field} {operation_id} does not match active stop operation {}",
            current_stop.operation_id
        )))
    }
}

impl SupervisorStopRequest {
    pub(crate) fn operation_id(&self) -> String {
        self.operation_id.clone()
    }

    pub(crate) fn complete(
        self,
        result: Result<types::SupervisorLifecycleServiceStopResponse, connectrpc::ConnectError>,
    ) {
        let _ = self.response_tx.send(result);
    }
}

pub(super) fn stop_response(
    disposition: types::RuntimeStopDisposition,
    status: types::SupervisorStatus,
) -> types::SupervisorLifecycleServiceStopResponse {
    types::SupervisorLifecycleServiceStopResponse {
        disposition: Some(disposition.into()),
        status: buffa::MessageField::some(status),
        ..Default::default()
    }
}
