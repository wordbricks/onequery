use std::pin::Pin;
#[cfg(test)]
use std::sync::Arc;
#[cfg(test)]
use std::sync::atomic::AtomicBool;
#[cfg(test)]
use std::sync::atomic::Ordering;

use buffa::MessageView;
use buffa::view::OwnedView;
use futures::Stream;
use futures::StreamExt;
use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleService;

use crate::supervisor_control_proto::types;

use super::actor::SupervisorControlActor;
use super::errors::failed_precondition;
use super::errors::invalid_argument;

#[derive(Clone)]
pub(crate) struct SupervisorControlService {
    actor: SupervisorControlActor,
    #[cfg(test)]
    panic_next_get_status: Arc<AtomicBool>,
}

impl SupervisorControlService {
    pub(crate) fn new(actor: SupervisorControlActor) -> Self {
        Self {
            actor,
            #[cfg(test)]
            panic_next_get_status: Arc::new(AtomicBool::new(false)),
        }
    }

    #[cfg(test)]
    pub(crate) fn new_with_next_get_status_panic(actor: SupervisorControlActor) -> Self {
        Self {
            actor,
            panic_next_get_status: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl SupervisorLifecycleService for SupervisorControlService {
    async fn open_runtime_session(
        &self,
        ctx: connectrpc::Context,
        mut requests: Pin<
            Box<
                dyn Stream<
                        Item = Result<
                            OwnedView<types::OpenRuntimeSessionRequestView<'static>>,
                            connectrpc::ConnectError,
                        >,
                    > + Send,
            >,
        >,
    ) -> Result<
        (
            Pin<
                Box<
                    dyn Stream<
                            Item = Result<
                                types::OpenRuntimeSessionResponse,
                                connectrpc::ConnectError,
                            >,
                        > + Send,
                >,
            >,
            connectrpc::Context,
        ),
        connectrpc::ConnectError,
    > {
        let first_request = requests
            .next()
            .await
            .ok_or_else(|| failed_precondition("runtime session closed before hello"))??;
        let hello = match first_request.payload.as_ref() {
            Some(types::open_runtime_session_request::PayloadView::Hello(hello)) => {
                Some(hello.as_ref())
            }
            _ => None,
        };
        let identity = self.actor.validate_session_hello(hello).await?;
        let (session_id, command_rx) = self.actor.open_runtime_session_commands(identity).await?;

        let actor = self.actor.clone();
        let (error_tx, error_rx) = tokio::sync::mpsc::channel(1);
        tokio::spawn(async move {
            while let Some(request) = requests.next().await {
                let request = match request {
                    Ok(request) => request,
                    Err(error) => {
                        let _ = error_tx.send(error).await;
                        break;
                    }
                };
                let result = match request.payload.as_ref() {
                    Some(types::open_runtime_session_request::PayloadView::Hello(_)) => {
                        Err(failed_precondition(
                            "runtime session hello must not be sent more than once",
                        ))
                    }
                    Some(types::open_runtime_session_request::PayloadView::Heartbeat(
                        heartbeat,
                    )) => {
                        actor
                            .apply_runtime_heartbeat(session_id, &heartbeat.to_owned_message())
                            .await
                    }
                    Some(types::open_runtime_session_request::PayloadView::RuntimeTransition(
                        transition,
                    )) => {
                        actor
                            .apply_runtime_transition(session_id, transition.to_owned_message())
                            .await
                    }
                    Some(types::open_runtime_session_request::PayloadView::RuntimeReady(ready)) => {
                        actor
                            .apply_runtime_ready(session_id, &ready.to_owned_message())
                            .await
                    }
                    Some(types::open_runtime_session_request::PayloadView::ShutdownStarted(
                        started,
                    )) => {
                        actor
                            .apply_runtime_shutdown_started(session_id, &started.to_owned_message())
                            .await
                    }
                    Some(types::open_runtime_session_request::PayloadView::ShutdownFinished(
                        finished,
                    )) => {
                        actor
                            .apply_runtime_shutdown_finished(
                                session_id,
                                &finished.to_owned_message(),
                            )
                            .await
                    }
                    Some(types::open_runtime_session_request::PayloadView::ShutdownFailed(
                        failed,
                    )) => {
                        actor
                            .apply_runtime_shutdown_failed(session_id, &failed.to_owned_message())
                            .await
                    }
                    None => Err(failed_precondition(
                        "runtime session request payload is required",
                    )),
                };
                if let Err(error) = result {
                    let _ = error_tx.send(error).await;
                    break;
                }
            }
            actor.close_runtime_session_commands(session_id).await;
        });

        Ok((
            Box::pin(runtime_session_command_stream(command_rx, error_rx)),
            ctx,
        ))
    }

    async fn get_status(
        &self,
        ctx: connectrpc::Context,
        request: OwnedView<types::SupervisorLifecycleServiceGetStatusRequestView<'static>>,
    ) -> Result<
        (
            types::SupervisorLifecycleServiceGetStatusResponse,
            connectrpc::Context,
        ),
        connectrpc::ConnectError,
    > {
        #[cfg(test)]
        if self.panic_next_get_status.swap(false, Ordering::SeqCst) {
            panic!("test supervisor control get_status panic");
        }

        self.actor
            .validate_target(request.target.as_option())
            .await?;

        Ok((
            types::SupervisorLifecycleServiceGetStatusResponse {
                status: buffa::MessageField::some(self.actor.snapshot().await),
                ..Default::default()
            },
            ctx,
        ))
    }

    async fn stop(
        &self,
        _ctx: connectrpc::Context,
        request: OwnedView<types::SupervisorLifecycleServiceStopRequestView<'static>>,
    ) -> Result<
        (
            types::SupervisorLifecycleServiceStopResponse,
            connectrpc::Context,
        ),
        connectrpc::ConnectError,
    > {
        self.actor
            .validate_target(request.target.as_option())
            .await?;
        validate_uuid(request.operation_id, "supervisor control stop operation_id")?;
        Ok((
            self.actor
                .request_stop(request.operation_id.map(str::to_owned).unwrap_or_default())
                .await?,
            _ctx,
        ))
    }

    async fn watch_status(
        &self,
        ctx: connectrpc::Context,
        request: OwnedView<types::SupervisorLifecycleServiceWatchStatusRequestView<'static>>,
    ) -> Result<
        (
            Pin<
                Box<
                    dyn Stream<
                            Item = Result<
                                types::SupervisorLifecycleServiceWatchStatusResponse,
                                connectrpc::ConnectError,
                            >,
                        > + Send,
                >,
            >,
            connectrpc::Context,
        ),
        connectrpc::ConnectError,
    > {
        self.actor
            .validate_target(request.target.as_option())
            .await?;

        let after_supervisor_sequence = request.after_supervisor_sequence.unwrap_or(0);
        let include_snapshot = request.include_snapshot.unwrap_or(false);
        Ok((
            self.actor
                .watch_status(after_supervisor_sequence, include_snapshot)
                .await,
            ctx,
        ))
    }
}

fn runtime_session_command_stream(
    command_rx: tokio::sync::mpsc::Receiver<types::OpenRuntimeSessionResponse>,
    error_rx: tokio::sync::mpsc::Receiver<connectrpc::ConnectError>,
) -> impl Stream<Item = Result<types::OpenRuntimeSessionResponse, connectrpc::ConnectError>> + Send
{
    futures::stream::unfold(
        (command_rx, error_rx),
        |(mut command_rx, mut error_rx)| async {
            if let Ok(error) = error_rx.try_recv() {
                return Some((Err(error), (command_rx, error_rx)));
            }

            tokio::select! {
                biased;

                error = error_rx.recv() => error.map(|error| (Err(error), (command_rx, error_rx))),
                command = command_rx.recv() => command.map(|command| (Ok(command), (command_rx, error_rx))),
            }
        },
    )
}

fn validate_uuid(value: Option<&str>, field: &'static str) -> Result<(), connectrpc::ConnectError> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Err(invalid_argument(format!("{field} is required")));
    };
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| invalid_argument(format!("{field} must be a UUID")))
}
