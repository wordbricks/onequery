use std::pin::Pin;

use buffa::MessageView;
use buffa::view::OwnedView;
use futures::Stream;
use futures::StreamExt;
use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleService;

use crate::runtime_control::types;

use super::actor::SupervisorControlActor;
use super::errors::failed_precondition;

#[derive(Clone)]
pub(crate) struct SupervisorControlService {
    actor: SupervisorControlActor,
}

impl SupervisorControlService {
    pub(crate) fn new(actor: SupervisorControlActor) -> Self {
        Self { actor }
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
        let (session_id, command_rx) = self.actor.open_runtime_session_commands(identity).await;

        let actor = self.actor.clone();
        tokio::spawn(async move {
            while let Some(request) = requests.next().await {
                let Ok(request) = request else {
                    break;
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
                    Some(types::open_runtime_session_request::PayloadView::RuntimeExiting(
                        exiting,
                    )) => {
                        actor
                            .apply_runtime_exiting(session_id, &exiting.to_owned_message())
                            .await
                    }
                    None => Err(failed_precondition(
                        "runtime session request payload is required",
                    )),
                };
                if result.is_err() {
                    break;
                }
            }
            actor.close_runtime_session_commands(session_id).await;
        });

        Ok((Box::pin(runtime_session_command_stream(command_rx)), ctx))
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
        let command = request
            .command
            .as_option()
            .ok_or_else(|| failed_precondition("supervisor control stop command is required"))?;
        self.actor
            .validate_target(command.target.as_option())
            .await?;
        Ok((
            self.actor.request_stop(command.to_owned_message()).await?,
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
) -> impl Stream<Item = Result<types::OpenRuntimeSessionResponse, connectrpc::ConnectError>> + Send
{
    futures::stream::unfold(command_rx, |mut command_rx| async {
        command_rx
            .recv()
            .await
            .map(|command| (Ok(command), command_rx))
    })
}
