#![allow(dead_code)]
#![allow(clippy::unwrap_used)]
// Generated Connect/Buffa transport code does not follow this workspace's
// stricter Clippy policy. Keep the lint boundary at the generated proto crate
// rather than patching checked-in emitted files.
#![allow(clippy::redundant_closure)]
#![allow(clippy::redundant_closure_for_method_calls)]
#![allow(clippy::enum_variant_names)]
#![allow(clippy::uninlined_format_args)]

#[path = "generated/connect/mod.rs"]
mod connect;
#[path = "generated/proto/mod.rs"]
pub mod proto;

pub mod google {
    pub mod rpc {
        pub use crate::proto::google::rpc::*;
    }
}

pub mod onequery {
    pub mod runtime {
        pub mod v1 {
            pub use crate::connect::onequery::runtime::v1::*;
            pub use crate::proto::onequery::runtime::v1::*;
        }
    }
}
