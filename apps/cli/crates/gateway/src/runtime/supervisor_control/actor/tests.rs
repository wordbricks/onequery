use buffa::MessageField;
use futures::StreamExt;
use pretty_assertions::assert_eq;
use tokio::time::Duration;
use tokio::time::timeout;

use super::*;

#[tokio::test]
async fn watch_status_emits_initial_snapshot_when_requested() {
    let actor = SupervisorControlActor::new(supervisor_status(7));

    let mut stream = actor.watch_status(0, true).await;
    let expected = actor.snapshot().await;
    let response = stream
        .next()
        .await
        .expect("expected snapshot response")
        .expect("expected successful snapshot response");

    let Some(types::supervisor_lifecycle_service_watch_status_response::Event::Snapshot(snapshot)) =
        response.event
    else {
        panic!("expected snapshot event");
    };
    assert_eq!(*snapshot, expected);
}

#[tokio::test]
async fn watch_status_filters_supervisor_transitions_by_sequence() {
    let actor = SupervisorControlActor::new(supervisor_status(1));

    let mut stream = actor.watch_status(2, false).await;
    actor
        .publish_supervisor_transition(supervisor_transition(2), supervisor_status(2))
        .await;
    actor
        .publish_supervisor_transition(supervisor_transition(3), supervisor_status(3))
        .await;

    let response = stream
        .next()
        .await
        .expect("expected transition response")
        .expect("expected successful transition response");

    let Some(
        types::supervisor_lifecycle_service_watch_status_response::Event::SupervisorTransition(
            transition,
        ),
    ) = response.event
    else {
        panic!("expected supervisor transition event");
    };
    assert_eq!(transition.supervisor_sequence, Some(3));
}

#[tokio::test]
async fn watch_status_delivers_runtime_transitions_after_subscription_when_sequence_filtered() {
    let actor = SupervisorControlActor::new(supervisor_status(5));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    actor
        .publish_supervisor_transition(supervisor_transition(5), supervisor_status(5))
        .await;

    let mut stream = actor.watch_status(5, false).await;
    actor
        .apply_runtime_transition(
            session_id,
            types::RuntimeTransition {
                transition_id: Some("runtime-draining".to_owned()),
                runtime_sequence: Some(8),
                previous_phase: Some(types::RuntimePhase::RUNTIME_PHASE_READY.into()),
                current_phase: Some(types::RuntimePhase::RUNTIME_PHASE_DRAINING.into()),
                reason: Some("draining".to_owned()),
                occurred_at: MessageField::some(timestamp(8)),
                ..Default::default()
            },
        )
        .await
        .expect("runtime transition should be accepted");

    let response = stream
        .next()
        .await
        .expect("expected runtime transition response")
        .expect("expected successful runtime transition response");
    let Some(types::supervisor_lifecycle_service_watch_status_response::Event::RuntimeTransition(
        transition,
    )) = response.event
    else {
        panic!("expected runtime transition event");
    };
    assert_eq!(transition.runtime_sequence, Some(8));
    assert_eq!(
        transition.current_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_DRAINING.into())
    );
}

#[tokio::test]
async fn close_runtime_session_publishes_active_session_snapshot() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    let mut stream = actor.watch_status(0, false).await;

    actor.close_runtime_session_commands(session_id).await;

    let response = stream
        .next()
        .await
        .expect("expected session close snapshot response")
        .expect("expected successful snapshot response");
    let Some(types::supervisor_lifecycle_service_watch_status_response::Event::Snapshot(snapshot)) =
        response.event
    else {
        panic!("expected snapshot event");
    };
    assert_eq!(snapshot.active_session, Some(false));
}

#[tokio::test]
async fn runtime_ready_event_marks_active_session_and_wakes_waiters() {
    let mut initial_status = supervisor_status(1);
    initial_status.phase = Some(types::SupervisorPhase::SUPERVISOR_PHASE_STARTING.into());
    let actor = SupervisorControlActor::new(initial_status);
    let waiter = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.wait_for_runtime_ready().await })
    };

    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    actor
        .apply_runtime_ready(session_id, &runtime_ready())
        .await
        .expect("runtime_ready should be accepted");

    let runtime_pid = timeout(Duration::from_secs(1), waiter)
        .await
        .expect("runtime ready waiter should wake")
        .expect("runtime ready waiter task should complete");
    let status = actor.snapshot().await;

    assert_eq!(runtime_pid, 4242);
    assert_eq!(status.active_session, Some(true));
    assert_eq!(
        status.phase,
        Some(types::SupervisorPhase::SUPERVISOR_PHASE_STARTING.into())
    );
    assert_eq!(
        status.runtime_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_READY.into())
    );
    assert_eq!(status.runtime_sequence, Some(2));
    assert_eq!(status.supervisor_sequence, Some(1));
}

#[tokio::test]
async fn runtime_heartbeat_does_not_mutate_lifecycle_status_or_publish_watch_event() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    actor
        .apply_runtime_ready(session_id, &runtime_ready())
        .await
        .expect("runtime_ready should be accepted");
    let before = actor.snapshot().await;
    let mut stream = actor.watch_status(0, false).await;

    actor
        .apply_runtime_heartbeat(
            session_id,
            &types::RuntimeSessionHeartbeat {
                heartbeat_sequence: Some(1),
                sent_at: MessageField::some(timestamp(99)),
                ..Default::default()
            },
        )
        .await
        .expect("heartbeat should be accepted");
    let after = actor.snapshot().await;

    assert_eq!(after.runtime_phase, before.runtime_phase);
    assert_eq!(after.runtime_sequence, before.runtime_sequence);
    assert_eq!(after.updated_at, before.updated_at);
    assert_eq!(after.active_session, Some(true));
    assert!(
        timeout(Duration::from_millis(25), stream.next())
            .await
            .is_err(),
        "heartbeat should not publish a watch event"
    );
}

#[tokio::test]
async fn stop_command_is_delivered_to_active_session() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (_session_id, mut commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");

    actor
        .send_stop_command(supervisor_stop_command())
        .await
        .expect("stop command should send to active session");

    let command = commands
        .recv()
        .await
        .expect("active session should receive stop command");
    let Some(types::open_runtime_session_response::Response::Stop(command)) = command.response
    else {
        panic!("expected stop command");
    };
    assert_eq!(
        command.operation_id.as_deref(),
        Some("00000000-0000-4000-8000-000000000001")
    );
}

#[tokio::test]
async fn runtime_session_can_be_replaced_after_close() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (first_session_id, _first_commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("first runtime session should open");
    actor.close_runtime_session_commands(first_session_id).await;

    let (_second_session_id, _second_commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("second runtime session should open after close");

    assert_eq!(actor.snapshot().await.active_session, Some(true));
}

#[tokio::test]
async fn stale_session_close_does_not_clear_newer_session() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (first_session_id, _first_commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("first runtime session should open");
    actor.close_runtime_session_commands(first_session_id).await;
    let (_second_session_id, _second_commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("second runtime session should open");

    actor.close_runtime_session_commands(first_session_id).await;

    assert_eq!(actor.snapshot().await.active_session, Some(true));
}

#[tokio::test]
async fn duplicate_stop_operation_id_returns_already_stopping() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let first_stop = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.request_stop(stop_operation_id()).await })
    };
    let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
        .await
        .expect("first stop request should be received")
        .expect("first stop request should be present");

    let response = actor
        .request_stop(stop_operation_id())
        .await
        .expect("duplicate stop request should be idempotent");

    assert_eq!(
        response.disposition.and_then(|value| value.as_known()),
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
    );

    first_request.complete(Ok(stop_response(
        types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
        actor.snapshot().await,
    )));
    first_stop
        .await
        .expect("first stop task should complete")
        .expect("first stop response should be successful");
}

#[tokio::test]
async fn accepted_stop_remains_idempotent_until_lifecycle_terminal() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let first_stop = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.request_stop(stop_operation_id()).await })
    };
    let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
        .await
        .expect("first stop request should be received")
        .expect("first stop request should be present");
    first_request.complete(Ok(stop_response(
        types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
        actor.snapshot().await,
    )));
    first_stop
        .await
        .expect("first stop task should complete")
        .expect("first stop response should be successful");

    let response = actor
        .request_stop(stop_operation_id())
        .await
        .expect("duplicate stop request should remain idempotent");

    assert_eq!(
        response.disposition.and_then(|value| value.as_known()),
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
    );
}

#[tokio::test]
async fn terminal_supervisor_transition_clears_stop_operation() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let first_stop = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.request_stop(stop_operation_id()).await })
    };
    let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
        .await
        .expect("first stop request should be received")
        .expect("first stop request should be present");
    first_request.complete(Ok(stop_response(
        types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
        actor.snapshot().await,
    )));
    first_stop
        .await
        .expect("first stop task should complete")
        .expect("first stop response should be successful");

    actor
        .apply_supervisor_transition(
            supervisor_transition_to_phase(2, types::SupervisorPhase::SUPERVISOR_PHASE_EXITED),
            None,
        )
        .await;
    let second_stop = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.request_stop(stop_operation_id()).await })
    };

    let second_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
        .await
        .expect("second stop request should be received")
        .expect("second stop request should be present");
    second_request.complete(Ok(stop_response(
        types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
        actor.snapshot().await,
    )));
    second_stop
        .await
        .expect("second stop task should complete")
        .expect("second stop response should be successful");
}

#[tokio::test]
async fn runtime_shutdown_finished_keeps_stop_operation_until_terminal_lifecycle() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    let first_stop = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.request_stop(stop_operation_id()).await })
    };
    let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
        .await
        .expect("first stop request should be received")
        .expect("first stop request should be present");
    first_request.complete(Ok(stop_response(
        types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
        actor.snapshot().await,
    )));
    first_stop
        .await
        .expect("first stop task should complete")
        .expect("first stop response should be successful");

    actor
        .apply_runtime_shutdown_finished(session_id, &runtime_shutdown_finished())
        .await
        .expect("shutdown_finished should be accepted");
    let response = actor
        .request_stop(stop_operation_id())
        .await
        .expect("duplicate stop request should remain idempotent");

    assert_eq!(
        response.disposition.and_then(|value| value.as_known()),
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
    );
}

#[tokio::test]
async fn different_stop_operation_id_returns_already_stopping() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let first_stop = {
        let actor = actor.clone();
        tokio::spawn(async move { actor.request_stop(stop_operation_id()).await })
    };
    let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
        .await
        .expect("first stop request should be received")
        .expect("first stop request should be present");

    let response = actor
        .request_stop("00000000-0000-4000-8000-000000000002".to_owned())
        .await
        .expect("overlapping stop request should be idempotent");

    assert_eq!(
        response.disposition.and_then(|value| value.as_known()),
        Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
    );

    first_request.complete(Ok(stop_response(
        types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
        actor.snapshot().await,
    )));
    first_stop
        .await
        .expect("first stop task should complete")
        .expect("first stop response should be successful");
}

#[tokio::test]
async fn runtime_ready_uses_session_identity_for_status() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    let ready = runtime_ready();

    actor
        .apply_runtime_ready(session_id, &ready)
        .await
        .expect("runtime_ready should be accepted");
    let status = actor.snapshot().await;

    assert_eq!(status.runtime_sequence, Some(2));
    assert_eq!(
        status.runtime_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_READY.into())
    );
    assert_eq!(
        status
            .runtime
            .as_option()
            .and_then(|identity| identity.launch_id.as_deref()),
        Some("launch-a")
    );
}

#[tokio::test]
async fn shutdown_finished_updates_status_and_watchers() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    let mut stream = actor.watch_status(0, false).await;

    actor
        .apply_runtime_shutdown_finished(session_id, &runtime_shutdown_finished())
        .await
        .expect("shutdown_finished should be accepted");

    let status = actor.snapshot().await;
    assert_eq!(
        status.runtime_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED.into())
    );
    assert_eq!(status.runtime_sequence, Some(4));

    let response = stream
        .next()
        .await
        .expect("expected runtime transition response")
        .expect("expected successful transition response");
    let Some(types::supervisor_lifecycle_service_watch_status_response::Event::RuntimeTransition(
        transition,
    )) = response.event
    else {
        panic!("expected runtime transition event");
    };
    assert_eq!(
        transition.current_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED.into())
    );
}

#[tokio::test]
async fn runtime_shutdown_failed_updates_status_from_required_status() {
    let actor = SupervisorControlActor::new(supervisor_status(1));
    let (session_id, _commands) = actor
        .open_runtime_session_commands(session_identity())
        .await
        .expect("runtime session should open");
    let mut stream = actor.watch_status(0, false).await;

    actor
        .apply_runtime_shutdown_failed(session_id, &runtime_shutdown_failed())
        .await
        .expect("shutdown_failed should be accepted");

    let status = actor.snapshot().await;
    assert_eq!(
        status.runtime_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED.into())
    );
    assert_eq!(status.runtime_sequence, Some(5));

    let response = stream
        .next()
        .await
        .expect("expected runtime transition response")
        .expect("expected successful transition response");
    let Some(types::supervisor_lifecycle_service_watch_status_response::Event::RuntimeTransition(
        transition,
    )) = response.event
    else {
        panic!("expected runtime transition event");
    };
    assert_eq!(transition.runtime_sequence, Some(5));
    assert_eq!(
        transition.current_phase,
        Some(types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED.into())
    );
    assert_eq!(
        transition
            .failure
            .as_option()
            .and_then(|failure| failure.message.as_deref()),
        Some("stop failed")
    );
}

fn supervisor_status(sequence: u64) -> types::SupervisorStatus {
    types::SupervisorStatus {
        identity: MessageField::some(types::SupervisorIdentity {
            supervisor_id: Some("gateway-supervisor:test".to_owned()),
            pid: Some(1),
            generation: Some(1),
            ..Default::default()
        }),
        launch: MessageField::some(types::LifecycleLaunchIdentity {
            launch_id: Some("launch-a".to_owned()),
            data_dir: Some("/tmp/onequery-data".to_owned()),
            runtime_pid: Some(4242),
            supervisor_pid: Some(1),
            supervisor_generation: Some(1),
            ..Default::default()
        }),
        phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into()),
        supervisor_sequence: Some(sequence),
        runtime: MessageField::some(types::RuntimeIdentity {
            data_dir: Some("/tmp/onequery-data".to_owned()),
            launch_id: Some("launch-a".to_owned()),
            pid: Some(4242),
            ..Default::default()
        }),
        runtime_phase: Some(types::RuntimePhase::RUNTIME_PHASE_STARTING.into()),
        active_session: Some(false),
        ..Default::default()
    }
}

fn session_identity() -> RuntimeSessionIdentity {
    RuntimeSessionIdentity {
        launch_id: "launch-a".to_owned(),
        data_dir: "/tmp/onequery-data".to_owned(),
        runtime_pid: 4242,
    }
}

fn runtime_ready() -> types::RuntimeReady {
    types::RuntimeReady {
        status: MessageField::some(types::RuntimeStatus {
            phase: Some(types::RuntimePhase::RUNTIME_PHASE_READY.into()),
            runtime_sequence: Some(2),
            updated_at: MessageField::some(timestamp(2)),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn runtime_shutdown_finished() -> types::RuntimeShutdownFinished {
    types::RuntimeShutdownFinished {
        operation_id: Some(stop_operation_id()),
        status: MessageField::some(types::RuntimeStatus {
            phase: Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED.into()),
            runtime_sequence: Some(4),
            updated_at: MessageField::some(timestamp(4)),
            ..Default::default()
        }),
        finished_at: MessageField::some(timestamp(4)),
        ..Default::default()
    }
}

fn runtime_shutdown_failed() -> types::RuntimeShutdownFailed {
    let failure = runtime_failure();
    types::RuntimeShutdownFailed {
        operation_id: Some(stop_operation_id()),
        failure: MessageField::some(failure.clone()),
        status: MessageField::some(types::RuntimeStatus {
            failure: MessageField::some(failure),
            phase: Some(types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED.into()),
            runtime_sequence: Some(5),
            updated_at: MessageField::some(timestamp(5)),
            ..Default::default()
        }),
        failed_at: MessageField::some(timestamp(5)),
        ..Default::default()
    }
}

fn runtime_failure() -> types::RuntimeFailure {
    types::RuntimeFailure {
        code: Some(types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL.into()),
        message: Some("stop failed".to_owned()),
        retryable: Some(false),
        ..Default::default()
    }
}

fn timestamp(seconds: i64) -> buffa_types::google::protobuf::Timestamp {
    buffa_types::google::protobuf::Timestamp {
        seconds,
        ..Default::default()
    }
}

fn supervisor_stop_command() -> types::SupervisorStopCommand {
    types::SupervisorStopCommand {
        operation_id: Some(stop_operation_id()),
        reason: Some("test stop".to_owned()),
        completion: Some(
            types::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT.into(),
        ),
        ..Default::default()
    }
}

fn stop_operation_id() -> String {
    "00000000-0000-4000-8000-000000000001".to_owned()
}

fn supervisor_transition(sequence: u64) -> types::SupervisorTransition {
    supervisor_transition_to_phase(sequence, types::SupervisorPhase::SUPERVISOR_PHASE_READY)
}

fn supervisor_transition_to_phase(
    sequence: u64,
    current_phase: types::SupervisorPhase,
) -> types::SupervisorTransition {
    types::SupervisorTransition {
        supervisor: MessageField::some(types::SupervisorIdentity {
            supervisor_id: Some("gateway-supervisor:test".to_owned()),
            pid: Some(1),
            generation: Some(1),
            ..Default::default()
        }),
        supervisor_sequence: Some(sequence),
        previous_phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING.into()),
        current_phase: Some(current_phase.into()),
        reason: Some("test".to_owned()),
        ..Default::default()
    }
}
