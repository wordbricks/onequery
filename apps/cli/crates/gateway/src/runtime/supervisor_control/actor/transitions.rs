use crate::supervisor_control_proto::types;

pub(super) fn runtime_transition_from_status_update(
    transition_id_prefix: &str,
    previous_phase: types::RuntimePhase,
    runtime_status: &types::RuntimeStatus,
    operation_id: Option<String>,
) -> types::RuntimeTransition {
    let current_phase = runtime_status
        .phase
        .and_then(|phase| phase.as_known())
        .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED);
    runtime_transition_from_fields(RuntimeTransitionFields {
        transition_id: format!(
            "{transition_id_prefix}:{}",
            runtime_status.runtime_sequence.unwrap_or(0)
        ),
        runtime_sequence: runtime_status.runtime_sequence,
        previous_phase,
        current_phase,
        reason: transition_id_prefix.replace('-', " "),
        occurred_at: runtime_status.updated_at.clone(),
        failure: runtime_status.failure.as_option().cloned(),
        caller_operation_id: operation_id,
    })
}

pub(super) struct RuntimeTransitionFields {
    pub(super) transition_id: String,
    pub(super) runtime_sequence: Option<u64>,
    pub(super) previous_phase: types::RuntimePhase,
    pub(super) current_phase: types::RuntimePhase,
    pub(super) reason: String,
    pub(super) occurred_at: buffa::MessageField<buffa_types::google::protobuf::Timestamp>,
    pub(super) failure: Option<types::RuntimeFailure>,
    pub(super) caller_operation_id: Option<String>,
}

pub(super) fn runtime_transition_from_fields(
    fields: RuntimeTransitionFields,
) -> types::RuntimeTransition {
    types::RuntimeTransition {
        transition_id: Some(fields.transition_id),
        runtime_sequence: fields.runtime_sequence,
        previous_phase: Some(fields.previous_phase.into()),
        current_phase: Some(fields.current_phase.into()),
        reason: Some(fields.reason),
        occurred_at: fields.occurred_at,
        failure: fields
            .failure
            .map(buffa::MessageField::some)
            .unwrap_or_default(),
        caller_operation_id: fields.caller_operation_id,
        ..Default::default()
    }
}
