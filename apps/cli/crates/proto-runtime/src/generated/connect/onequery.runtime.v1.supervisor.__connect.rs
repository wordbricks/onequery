///Shorthand for `OwnedView<OpenRuntimeSessionRequestView<'static>>`.
pub type OwnedOpenRuntimeSessionRequestView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionRequestView<
        'static,
    >,
>;
///Shorthand for `OwnedView<OpenRuntimeSessionResponseView<'static>>`.
pub type OwnedOpenRuntimeSessionResponseView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionResponseView<
        'static,
    >,
>;
///Shorthand for `OwnedView<SupervisorLifecycleServiceGetStatusRequestView<'static>>`.
pub type OwnedSupervisorLifecycleServiceGetStatusRequestView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusRequestView<
        'static,
    >,
>;
///Shorthand for `OwnedView<SupervisorLifecycleServiceGetStatusResponseView<'static>>`.
pub type OwnedSupervisorLifecycleServiceGetStatusResponseView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusResponseView<
        'static,
    >,
>;
///Shorthand for `OwnedView<SupervisorLifecycleServiceStopRequestView<'static>>`.
pub type OwnedSupervisorLifecycleServiceStopRequestView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopRequestView<
        'static,
    >,
>;
///Shorthand for `OwnedView<SupervisorLifecycleServiceStopResponseView<'static>>`.
pub type OwnedSupervisorLifecycleServiceStopResponseView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopResponseView<
        'static,
    >,
>;
///Shorthand for `OwnedView<SupervisorLifecycleServiceWatchStatusRequestView<'static>>`.
pub type OwnedSupervisorLifecycleServiceWatchStatusRequestView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusRequestView<
        'static,
    >,
>;
///Shorthand for `OwnedView<SupervisorLifecycleServiceWatchStatusResponseView<'static>>`.
pub type OwnedSupervisorLifecycleServiceWatchStatusResponseView = ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusResponseView<
        'static,
    >,
>;
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponse,
>
for crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionResponseView<
    '_,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponse,
>
for ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionResponseView<
        'static,
    >,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(&**self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponse,
>
for crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusResponseView<
    '_,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponse,
>
for ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusResponseView<
        'static,
    >,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(&**self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponse,
>
for crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopResponseView<
    '_,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponse,
>
for ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopResponseView<
        'static,
    >,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(&**self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponse,
>
for crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusResponseView<
    '_,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(self, codec)
    }
}
impl ::connectrpc::Encodable<
    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponse,
>
for ::buffa::view::OwnedView<
    crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusResponseView<
        'static,
    >,
> {
    fn encode(
        &self,
        codec: ::connectrpc::CodecFormat,
    ) -> ::std::result::Result<::buffa::bytes::Bytes, ::connectrpc::ConnectError> {
        ::connectrpc::__codegen::encode_view_body(&**self, codec)
    }
}
/// Full service name for this service.
pub const SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME: &str = "onequery.runtime.v1.SupervisorLifecycleService";
/// Static [`Spec`](::connectrpc::Spec) for the server-side `OpenRuntimeSession` RPC.
///
/// The dispatcher surfaces this on
/// [`RequestContext::spec`](::connectrpc::RequestContext::spec).
pub const SUPERVISOR_LIFECYCLE_SERVICE_OPEN_RUNTIME_SESSION_SPEC: ::connectrpc::Spec = ::connectrpc::Spec::server(
        "/onequery.runtime.v1.SupervisorLifecycleService/OpenRuntimeSession",
        ::connectrpc::StreamType::BidiStream,
    )
    .with_idempotency_level(::connectrpc::IdempotencyLevel::Unknown);
/// Static [`Spec`](::connectrpc::Spec) for the server-side `GetStatus` RPC.
///
/// The dispatcher surfaces this on
/// [`RequestContext::spec`](::connectrpc::RequestContext::spec).
pub const SUPERVISOR_LIFECYCLE_SERVICE_GET_STATUS_SPEC: ::connectrpc::Spec = ::connectrpc::Spec::server(
        "/onequery.runtime.v1.SupervisorLifecycleService/GetStatus",
        ::connectrpc::StreamType::Unary,
    )
    .with_idempotency_level(::connectrpc::IdempotencyLevel::NoSideEffects);
/// Static [`Spec`](::connectrpc::Spec) for the server-side `Stop` RPC.
///
/// The dispatcher surfaces this on
/// [`RequestContext::spec`](::connectrpc::RequestContext::spec).
pub const SUPERVISOR_LIFECYCLE_SERVICE_STOP_SPEC: ::connectrpc::Spec = ::connectrpc::Spec::server(
        "/onequery.runtime.v1.SupervisorLifecycleService/Stop",
        ::connectrpc::StreamType::Unary,
    )
    .with_idempotency_level(::connectrpc::IdempotencyLevel::Unknown);
/// Static [`Spec`](::connectrpc::Spec) for the server-side `WatchStatus` RPC.
///
/// The dispatcher surfaces this on
/// [`RequestContext::spec`](::connectrpc::RequestContext::spec).
pub const SUPERVISOR_LIFECYCLE_SERVICE_WATCH_STATUS_SPEC: ::connectrpc::Spec = ::connectrpc::Spec::server(
        "/onequery.runtime.v1.SupervisorLifecycleService/WatchStatus",
        ::connectrpc::StreamType::ServerStream,
    )
    .with_idempotency_level(::connectrpc::IdempotencyLevel::NoSideEffects);
/// Server trait for SupervisorLifecycleService.
///
/// # Implementing handlers
///
/// Handlers receive requests as `OwnedFooView` (an alias for
/// `OwnedView<FooView<'static>>`), which gives zero-copy borrowed access
/// to fields (e.g. `request.name` is a `&str` into the decoded buffer).
/// The view can be held across `.await` points. When two RPC types in
/// the same package would alias to the same `Owned<…>View` name (e.g.
/// a local message plus an imported one with the same short name), the
/// alias is suppressed for both and the request type is spelled as
/// `OwnedView<…View<'static>>` directly in the trait signature.
///
/// Implement methods with plain `async fn`; the returned future satisfies
/// the `Send` bound automatically. See the
/// [buffa user guide](https://github.com/anthropics/buffa/blob/main/docs/guide.md#ownedview-in-async-trait-implementations)
/// for zero-copy access patterns and when `to_owned_message()` is needed.
///
/// The `impl Encodable<Out>` return bound accepts the owned `Out`, the
/// generated `OutView<'_>` / `OwnedOutView`,
/// [`MaybeBorrowed`](::connectrpc::MaybeBorrowed), or
/// [`PreEncoded`](::connectrpc::PreEncoded) for handlers that encode a
/// non-`'static` view internally and pass the bytes across the handler
/// boundary. View bodies are not emitted for output types mapped via
/// `extern_path` (the impl would be an orphan); return owned for
/// WKT/extern outputs.
///
/// Server-streaming and bidi-streaming methods return
/// `ServiceStream<impl Encodable<Out> + Send + use<Self>>`. The
/// `use<Self>` precise-capturing clause excludes `&self`'s lifetime
/// (unary methods use `use<'a, Self>` and may borrow), so stream items
/// must be `'static`. To stream view-encoded data, encode each item
/// inside the stream body and yield
/// [`PreEncoded`](::connectrpc::PreEncoded) — see its `# Streaming
/// example` doc.
#[allow(clippy::type_complexity)]
pub trait SupervisorLifecycleService: Send + Sync + 'static {
    /// Handle the OpenRuntimeSession RPC.
    fn open_runtime_session(
        &self,
        ctx: ::connectrpc::RequestContext,
        requests: ::connectrpc::ServiceStream<OwnedOpenRuntimeSessionRequestView>,
    ) -> impl ::std::future::Future<
        Output = ::connectrpc::ServiceResult<
            ::connectrpc::ServiceStream<
                impl ::connectrpc::Encodable<
                    crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponse,
                > + Send + use<Self>,
            >,
        >,
    > + Send;
    /// Handle the GetStatus RPC.
    ///
    /// `'a` lets the response body borrow from `&self` (e.g. server-resident state).
    fn get_status<'a>(
        &'a self,
        ctx: ::connectrpc::RequestContext,
        request: OwnedSupervisorLifecycleServiceGetStatusRequestView,
    ) -> impl ::std::future::Future<
        Output = ::connectrpc::ServiceResult<
            impl ::connectrpc::Encodable<
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponse,
            > + Send + use<'a, Self>,
        >,
    > + Send;
    /// Handle the Stop RPC.
    ///
    /// `'a` lets the response body borrow from `&self` (e.g. server-resident state).
    fn stop<'a>(
        &'a self,
        ctx: ::connectrpc::RequestContext,
        request: OwnedSupervisorLifecycleServiceStopRequestView,
    ) -> impl ::std::future::Future<
        Output = ::connectrpc::ServiceResult<
            impl ::connectrpc::Encodable<
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponse,
            > + Send + use<'a, Self>,
        >,
    > + Send;
    /// Handle the WatchStatus RPC.
    fn watch_status(
        &self,
        ctx: ::connectrpc::RequestContext,
        request: OwnedSupervisorLifecycleServiceWatchStatusRequestView,
    ) -> impl ::std::future::Future<
        Output = ::connectrpc::ServiceResult<
            ::connectrpc::ServiceStream<
                impl ::connectrpc::Encodable<
                    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponse,
                > + Send + use<Self>,
            >,
        >,
    > + Send;
}
/// Extension trait for registering a service implementation with a Router.
///
/// This trait is automatically implemented for all types that implement the service trait.
///
/// # Example
///
/// ```rust,ignore
/// use std::sync::Arc;
///
/// let service = Arc::new(MyServiceImpl);
/// let router = service.register(Router::new());
/// ```
pub trait SupervisorLifecycleServiceExt: SupervisorLifecycleService {
    /// Register this service implementation with a Router.
    ///
    /// Takes ownership of the `Arc<Self>` and returns a new Router with
    /// this service's methods registered.
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router;
}
impl<S: SupervisorLifecycleService> SupervisorLifecycleServiceExt for S {
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router {
        router
            .route_view_bidi_stream::<
                _,
                _,
                crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponse,
            >(
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "OpenRuntimeSession",
                ::connectrpc::view_bidi_streaming_handler_fn({
                    let svc = ::std::sync::Arc::clone(&self);
                    move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.open_runtime_session(ctx, req).await }
                    }
                }),
            )
            .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_OPEN_RUNTIME_SESSION_SPEC)
            .route_view_idempotent(
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "GetStatus",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req, format| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move {
                            svc.get_status(ctx, req)
                                .await?
                                .encode::<
                                    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponse,
                                >(format)
                        }
                    })
                },
            )
            .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_GET_STATUS_SPEC)
            .route_view(
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "Stop",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req, format| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move {
                            svc.stop(ctx, req)
                                .await?
                                .encode::<
                                    crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponse,
                                >(format)
                        }
                    })
                },
            )
            .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_STOP_SPEC)
            .route_view_server_stream::<
                _,
                _,
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponse,
            >(
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "WatchStatus",
                ::connectrpc::view_streaming_handler_fn({
                    let svc = ::std::sync::Arc::clone(&self);
                    move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.watch_status(ctx, req).await }
                    }
                }),
            )
            .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_WATCH_STATUS_SPEC)
    }
}
/// Monomorphic dispatcher for `SupervisorLifecycleService`.
///
/// Unlike `.register(Router)` which type-erases each method into an `Arc<dyn ErasedHandler>` stored in a `HashMap`, this struct dispatches via a compile-time `match` on method name: no vtable, no hash lookup.
///
/// # Example
///
/// ```rust,ignore
/// use connectrpc::ConnectRpcService;
///
/// let server = SupervisorLifecycleServiceServer::new(MyImpl);
/// let service = ConnectRpcService::new(server);
/// // hand `service` to axum/hyper as a fallback_service
/// ```
pub struct SupervisorLifecycleServiceServer<T> {
    inner: ::std::sync::Arc<T>,
}
impl<T: SupervisorLifecycleService> SupervisorLifecycleServiceServer<T> {
    /// Wrap a service implementation in a monomorphic dispatcher.
    pub fn new(service: T) -> Self {
        Self {
            inner: ::std::sync::Arc::new(service),
        }
    }
    /// Wrap an already-`Arc`'d service implementation.
    pub fn from_arc(inner: ::std::sync::Arc<T>) -> Self {
        Self { inner }
    }
}
impl<T> Clone for SupervisorLifecycleServiceServer<T> {
    fn clone(&self) -> Self {
        Self {
            inner: ::std::sync::Arc::clone(&self.inner),
        }
    }
}
impl<T: SupervisorLifecycleService> ::connectrpc::Dispatcher
for SupervisorLifecycleServiceServer<T> {
    #[inline]
    fn lookup(
        &self,
        path: &str,
    ) -> Option<::connectrpc::dispatcher::codegen::MethodDescriptor> {
        let method = path
            .strip_prefix("onequery.runtime.v1.SupervisorLifecycleService/")?;
        match method {
            "OpenRuntimeSession" => {
                Some(
                    ::connectrpc::dispatcher::codegen::MethodDescriptor::bidi_streaming()
                        .with_spec(
                            SUPERVISOR_LIFECYCLE_SERVICE_OPEN_RUNTIME_SESSION_SPEC,
                        ),
                )
            }
            "GetStatus" => {
                Some(
                    ::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true)
                        .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_GET_STATUS_SPEC),
                )
            }
            "Stop" => {
                Some(
                    ::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false)
                        .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_STOP_SPEC),
                )
            }
            "WatchStatus" => {
                Some(
                    ::connectrpc::dispatcher::codegen::MethodDescriptor::server_streaming()
                        .with_spec(SUPERVISOR_LIFECYCLE_SERVICE_WATCH_STATUS_SPEC),
                )
            }
            _ => None,
        }
    }
    fn call_unary(
        &self,
        path: &str,
        ctx: ::connectrpc::RequestContext,
        request: ::connectrpc::Payload,
        format: ::connectrpc::CodecFormat,
    ) -> ::connectrpc::dispatcher::codegen::UnaryResult {
        let Some(method) = path
            .strip_prefix("onequery.runtime.v1.SupervisorLifecycleService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "GetStatus" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusRequestView,
                    >(request.encoded()?, format)?;
                    svc.get_status(ctx, req)
                        .await?
                        .encode::<
                            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponse,
                        >(format)
                })
            }
            "Stop" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopRequestView,
                    >(request.encoded()?, format)?;
                    svc.stop(ctx, req)
                        .await?
                        .encode::<
                            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponse,
                        >(format)
                })
            }
            _ => ::connectrpc::dispatcher::codegen::unimplemented_unary(path),
        }
    }
    fn call_server_streaming(
        &self,
        path: &str,
        ctx: ::connectrpc::RequestContext,
        request: ::buffa::bytes::Bytes,
        format: ::connectrpc::CodecFormat,
    ) -> ::connectrpc::dispatcher::codegen::StreamingResult {
        let Some(method) = path
            .strip_prefix("onequery.runtime.v1.SupervisorLifecycleService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "WatchStatus" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusRequestView,
                    >(request, format)?;
                    let resp = svc.watch_status(ctx, req).await?;
                    Ok(
                        resp
                            .map_body(|s| ::connectrpc::dispatcher::codegen::encode_response_stream::<
                                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponse,
                                _,
                                _,
                            >(s, format)),
                    )
                })
            }
            _ => ::connectrpc::dispatcher::codegen::unimplemented_streaming(path),
        }
    }
    fn call_client_streaming(
        &self,
        path: &str,
        ctx: ::connectrpc::RequestContext,
        requests: ::connectrpc::dispatcher::codegen::RequestStream,
        format: ::connectrpc::CodecFormat,
    ) -> ::connectrpc::dispatcher::codegen::UnaryResult {
        let Some(method) = path
            .strip_prefix("onequery.runtime.v1.SupervisorLifecycleService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
            _ => ::connectrpc::dispatcher::codegen::unimplemented_unary(path),
        }
    }
    fn call_bidi_streaming(
        &self,
        path: &str,
        ctx: ::connectrpc::RequestContext,
        requests: ::connectrpc::dispatcher::codegen::RequestStream,
        format: ::connectrpc::CodecFormat,
    ) -> ::connectrpc::dispatcher::codegen::StreamingResult {
        let Some(method) = path
            .strip_prefix("onequery.runtime.v1.SupervisorLifecycleService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
            "OpenRuntimeSession" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req_stream = ::connectrpc::dispatcher::codegen::decode_view_request_stream::<
                        crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionRequestView,
                    >(requests, format);
                    let resp = svc.open_runtime_session(ctx, req_stream).await?;
                    Ok(
                        resp
                            .map_body(|s| ::connectrpc::dispatcher::codegen::encode_response_stream::<
                                crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponse,
                                _,
                                _,
                            >(s, format)),
                    )
                })
            }
            _ => ::connectrpc::dispatcher::codegen::unimplemented_streaming(path),
        }
    }
}
/// Client for this service.
///
/// Generic over `T: ClientTransport`. For **gRPC** (HTTP/2), use
/// `Http2Connection` — it has honest `poll_ready` and composes with
/// `tower::balance` for multi-connection load balancing. For **Connect
/// over HTTP/1.1** (or unknown protocol), use `HttpClient`.
///
/// # Example (gRPC / HTTP/2)
///
/// ```rust,ignore
/// use connectrpc::client::{Http2Connection, ClientConfig};
/// use connectrpc::Protocol;
///
/// let uri: http::Uri = "http://localhost:8080".parse()?;
/// let conn = Http2Connection::connect_plaintext(uri.clone()).await?.shared(1024);
/// let config = ClientConfig::new(uri).with_protocol(Protocol::Grpc);
///
/// let client = SupervisorLifecycleServiceClient::new(conn, config);
/// let response = client.open_runtime_session(request).await?;
/// ```
///
/// # Example (Connect / HTTP/1.1 or ALPN)
///
/// ```rust,ignore
/// use connectrpc::client::{HttpClient, ClientConfig};
///
/// let http = HttpClient::plaintext();  // cleartext http:// only
/// let config = ClientConfig::new("http://localhost:8080".parse()?);
///
/// let client = SupervisorLifecycleServiceClient::new(http, config);
/// let response = client.open_runtime_session(request).await?;
/// ```
///
/// # Working with the response
///
/// Unary calls return [`UnaryResponse<OwnedView<FooView>>`](::connectrpc::client::UnaryResponse).
/// The `OwnedView` derefs to the view, so field access is zero-copy:
///
/// ```rust,ignore
/// let resp = client.open_runtime_session(request).await?.into_view();
/// let name: &str = resp.name;  // borrow into the response buffer
/// ```
///
/// If you need the owned struct (e.g. to store or pass by value), use
/// [`into_owned()`](::connectrpc::client::UnaryResponse::into_owned):
///
/// ```rust,ignore
/// let owned = client.open_runtime_session(request).await?.into_owned();
/// ```
#[derive(Clone)]
pub struct SupervisorLifecycleServiceClient<T> {
    transport: T,
    config: ::connectrpc::client::ClientConfig,
}
impl<T> SupervisorLifecycleServiceClient<T>
where
    T: ::connectrpc::client::ClientTransport,
    <T::ResponseBody as ::http_body::Body>::Error: ::std::fmt::Display,
{
    /// Create a new client with the given transport and configuration.
    pub fn new(transport: T, config: ::connectrpc::client::ClientConfig) -> Self {
        Self { transport, config }
    }
    /// Get the client configuration.
    pub fn config(&self) -> &::connectrpc::client::ClientConfig {
        &self.config
    }
    /// Get a mutable reference to the client configuration.
    pub fn config_mut(&mut self) -> &mut ::connectrpc::client::ClientConfig {
        &mut self.config
    }
    /// Call the OpenRuntimeSession RPC. Sends a request to /onequery.runtime.v1.SupervisorLifecycleService/OpenRuntimeSession.
    pub async fn open_runtime_session(
        &self,
    ) -> Result<
        ::connectrpc::client::BidiStream<
            T::ResponseBody,
            crate::proto::onequery::runtime::v1::OpenRuntimeSessionRequest,
            crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionResponseView<
                'static,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.open_runtime_session_with_options(
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the OpenRuntimeSession RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn open_runtime_session_with_options(
        &self,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::BidiStream<
            T::ResponseBody,
            crate::proto::onequery::runtime::v1::OpenRuntimeSessionRequest,
            crate::proto::onequery::runtime::v1::__buffa::view::OpenRuntimeSessionResponseView<
                'static,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_bidi_stream(
                &self.transport,
                &self.config,
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "OpenRuntimeSession",
                options,
            )
            .await
    }
    /// Call the GetStatus RPC. Sends a request to /onequery.runtime.v1.SupervisorLifecycleService/GetStatus.
    pub async fn get_status(
        &self,
        request: crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.get_status_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the GetStatus RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn get_status_with_options(
        &self,
        request: crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceGetStatusResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "GetStatus",
                request,
                options,
            )
            .await
    }
    /// Call the Stop RPC. Sends a request to /onequery.runtime.v1.SupervisorLifecycleService/Stop.
    pub async fn stop(
        &self,
        request: crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.stop_with_options(request, ::connectrpc::client::CallOptions::default())
            .await
    }
    /// Call the Stop RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn stop_with_options(
        &self,
        request: crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceStopResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "Stop",
                request,
                options,
            )
            .await
    }
    /// Call the WatchStatus RPC. Sends a request to /onequery.runtime.v1.SupervisorLifecycleService/WatchStatus.
    pub async fn watch_status(
        &self,
        request: crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusRequest,
    ) -> Result<
        ::connectrpc::client::ServerStream<
            T::ResponseBody,
            crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusResponseView<
                'static,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.watch_status_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the WatchStatus RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn watch_status_with_options(
        &self,
        request: crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::ServerStream<
            T::ResponseBody,
            crate::proto::onequery::runtime::v1::__buffa::view::SupervisorLifecycleServiceWatchStatusResponseView<
                'static,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_server_stream(
                &self.transport,
                &self.config,
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "WatchStatus",
                request,
                options,
            )
            .await
    }
}
