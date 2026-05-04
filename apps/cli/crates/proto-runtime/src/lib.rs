#![allow(dead_code)]
#![allow(clippy::unwrap_used)]
// Generated Connect/Buffa transport code does not follow this workspace's
// stricter Clippy policy. Keep the lint boundary at the generated proto crate
// rather than patching checked-in emitted files.
#![allow(clippy::redundant_closure)]
#![allow(clippy::redundant_closure_for_method_calls)]
#![allow(clippy::enum_variant_names)]
#![allow(clippy::uninlined_format_args)]

// Comment: the generated file name is still runtime_control because it is
// derived from the runtime/v1 proto package path, not the supervisor-control
// service ownership in the gateway.
include!("generated/_runtime_control_connectrpc.rs");
