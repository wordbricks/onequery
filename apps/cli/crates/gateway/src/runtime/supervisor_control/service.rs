use std::pin::Pin;

use buffa::MessageView;
use buffa::view::OwnedView;
use futures::Stream;
use futures::StreamExt;
use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleService;

use crate::supervisor_control_proto::types;

use super::actor::SupervisorControlActor;
use super::errors::failed_precondition;
use super::errors::missing_required_field;

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
            Some(types::open_runtime_session_request::PayloadView::Hello(hello)) => hello.as_ref(),
            Some(_) => {
                return Err(failed_precondition(
                    "runtime session hello is required before lifecycle events",
                ));
            }
            None => {
                return Err(missing_required_field(
                    "open_runtime_session_request.payload",
                ));
            }
        };
        let identity = self.actor.validate_session_hello(hello).await?;
        let (session_id, command_rx) = self.actor.open_runtime_session_commands(identity).await?;
        let opened = types::OpenRuntimeSessionResponse {
            response: Some(types::open_runtime_session_response::Response::Opened(
                Box::new(types::RuntimeSessionOpened {
                    ..Default::default()
                }),
            )),
            ..Default::default()
        };

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
                    None => Err(missing_required_field(
                        "open_runtime_session_request.payload",
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
            Box::pin(runtime_session_command_stream(opened, command_rx, error_rx)),
            ctx,
        ))
    }

    async fn get_status(
        &self,
        ctx: connectrpc::Context,
        _request: OwnedView<types::SupervisorLifecycleServiceGetStatusRequestView<'static>>,
    ) -> Result<
        (
            types::SupervisorLifecycleServiceGetStatusResponse,
            connectrpc::Context,
        ),
        connectrpc::ConnectError,
    > {
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
        Ok((
            self.actor
                .request_stop(
                    request
                        .operation_id
                        .ok_or_else(|| missing_required_field("stop_request.operation_id"))?
                        .to_owned(),
                )
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
        let after_supervisor_sequence = request.after_supervisor_sequence.unwrap_or(0);
        let include_snapshot = request
            .include_snapshot
            .ok_or_else(|| missing_required_field("watch_status_request.include_snapshot"))?;
        Ok((
            self.actor
                .watch_status(after_supervisor_sequence, include_snapshot)
                .await,
            ctx,
        ))
    }
}

fn runtime_session_command_stream(
    opened: types::OpenRuntimeSessionResponse,
    command_rx: tokio::sync::mpsc::Receiver<types::OpenRuntimeSessionResponse>,
    error_rx: tokio::sync::mpsc::Receiver<connectrpc::ConnectError>,
) -> impl Stream<Item = Result<types::OpenRuntimeSessionResponse, connectrpc::ConnectError>> + Send
{
    futures::stream::once(async move { Ok(opened) }).chain(futures::stream::unfold(
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
    ))
}
