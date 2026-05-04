/// Full service name for this service.
pub const SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME: &str = "onequery.runtime.v1.SupervisorLifecycleService";
/// Server trait for SupervisorLifecycleService.
///
/// # Implementing handlers
///
/// Handlers receive requests as `OwnedView<FooView<'static>>`, which gives
/// zero-copy borrowed access to fields (e.g. `request.name` is a `&str`
/// into the decoded buffer). The view can be held across `.await` points.
///
/// Implement methods with plain `async fn`; the returned future satisfies
/// the `Send` bound automatically. See the
/// [buffa user guide](https://github.com/anthropics/buffa/blob/main/docs/guide.md#ownedview-in-async-trait-implementations)
/// for zero-copy access patterns and when `to_owned_message()` is needed.
#[allow(clippy::type_complexity)]
pub trait SupervisorLifecycleService: Send + Sync + 'static {
    /// Handle the OpenRuntimeSession RPC.
    fn open_runtime_session(
        &self,
        ctx: ::connectrpc::Context,
        requests: ::std::pin::Pin<
            Box<
                dyn ::futures::Stream<
                    Item = Result<
                        ::buffa::view::OwnedView<
                            crate::proto::onequery::runtime::v1::OpenRuntimeSessionRequestView<
                                'static,
                            >,
                        >,
                        ::connectrpc::ConnectError,
                    >,
                > + Send,
            >,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                ::std::pin::Pin<
                    Box<
                        dyn ::futures::Stream<
                            Item = Result<
                                crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponse,
                                ::connectrpc::ConnectError,
                            >,
                        > + Send,
                    >,
                >,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the GetStatus RPC.
    fn get_status(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusRequestView<
                'static,
            >,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the Stop RPC.
    fn stop(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopRequestView<
                'static,
            >,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the WatchStatus RPC.
    fn watch_status(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusRequestView<
                'static,
            >,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                ::std::pin::Pin<
                    Box<
                        dyn ::futures::Stream<
                            Item = Result<
                                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponse,
                                ::connectrpc::ConnectError,
                            >,
                        > + Send,
                    >,
                >,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
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
            .route_view_bidi_stream(
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
            .route_view_idempotent(
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "GetStatus",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.get_status(ctx, req).await }
                    })
                },
            )
            .route_view(
                SUPERVISOR_LIFECYCLE_SERVICE_SERVICE_NAME,
                "Stop",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.stop(ctx, req).await }
                    })
                },
            )
            .route_view_server_stream(
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
                    ::connectrpc::dispatcher::codegen::MethodDescriptor::bidi_streaming(),
                )
            }
            "GetStatus" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "Stop" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "WatchStatus" => {
                Some(
                    ::connectrpc::dispatcher::codegen::MethodDescriptor::server_streaming(),
                )
            }
            _ => None,
        }
    }
    fn call_unary(
        &self,
        path: &str,
        ctx: ::connectrpc::Context,
        request: ::buffa::bytes::Bytes,
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
                        crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.get_status(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "Stop" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.stop(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            _ => ::connectrpc::dispatcher::codegen::unimplemented_unary(path),
        }
    }
    fn call_server_streaming(
        &self,
        path: &str,
        ctx: ::connectrpc::Context,
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
                        crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusRequestView,
                    >(request, format)?;
                    let (resp_stream, ctx) = svc.watch_status(ctx, req).await?;
                    Ok((
                        ::connectrpc::dispatcher::codegen::encode_response_stream(
                            resp_stream,
                            format,
                        ),
                        ctx,
                    ))
                })
            }
            _ => ::connectrpc::dispatcher::codegen::unimplemented_streaming(path),
        }
    }
    fn call_client_streaming(
        &self,
        path: &str,
        ctx: ::connectrpc::Context,
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
        ctx: ::connectrpc::Context,
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
                        crate::proto::onequery::runtime::v1::OpenRuntimeSessionRequestView,
                    >(requests, format);
                    let (resp_stream, ctx) = svc
                        .open_runtime_session(ctx, req_stream)
                        .await?;
                    Ok((
                        ::connectrpc::dispatcher::codegen::encode_response_stream(
                            resp_stream,
                            format,
                        ),
                        ctx,
                    ))
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
/// let config = ClientConfig::new(uri).protocol(Protocol::Grpc);
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
            crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponseView<'static>,
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
            crate::proto::onequery::runtime::v1::OpenRuntimeSessionResponseView<'static>,
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
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponseView<
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
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceGetStatusResponseView<
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
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponseView<
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
                crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceStopResponseView<
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
            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponseView<
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
            crate::proto::onequery::runtime::v1::SupervisorLifecycleServiceWatchStatusResponseView<
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
