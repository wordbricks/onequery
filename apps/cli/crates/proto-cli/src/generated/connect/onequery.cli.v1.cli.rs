/// Full service name for this service.
pub const CLI_AUTH_SERVICE_SERVICE_NAME: &str = "onequery.cli.v1.CliAuthService";
/// Server trait for CliAuthService.
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
pub trait CliAuthService: Send + Sync + 'static {
    /// Handle the GetSession RPC.
    fn get_session(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::GetSessionRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (crate::proto::onequery::cli::v1::GetSessionResponse, ::connectrpc::Context),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the RefreshSession RPC.
    fn refresh_session(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::RefreshSessionRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::RefreshSessionResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the StartDeviceAuthorization RPC.
    fn start_device_authorization(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::StartDeviceAuthorizationRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::StartDeviceAuthorizationResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the PollDeviceAuthorization RPC.
    fn poll_device_authorization(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::PollDeviceAuthorizationRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::PollDeviceAuthorizationResponse,
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
pub trait CliAuthServiceExt: CliAuthService {
    /// Register this service implementation with a Router.
    ///
    /// Takes ownership of the `Arc<Self>` and returns a new Router with
    /// this service's methods registered.
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router;
}
impl<S: CliAuthService> CliAuthServiceExt for S {
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router {
        router
            .route_view_idempotent(
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "GetSession",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.get_session(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "RefreshSession",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.refresh_session(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "StartDeviceAuthorization",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.start_device_authorization(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "PollDeviceAuthorization",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.poll_device_authorization(ctx, req).await }
                    })
                },
            )
    }
}
/// Monomorphic dispatcher for `CliAuthService`.
///
/// Unlike `.register(Router)` which type-erases each method into an `Arc<dyn ErasedHandler>` stored in a `HashMap`, this struct dispatches via a compile-time `match` on method name: no vtable, no hash lookup.
///
/// # Example
///
/// ```rust,ignore
/// use connectrpc::ConnectRpcService;
///
/// let server = CliAuthServiceServer::new(MyImpl);
/// let service = ConnectRpcService::new(server);
/// // hand `service` to axum/hyper as a fallback_service
/// ```
pub struct CliAuthServiceServer<T> {
    inner: ::std::sync::Arc<T>,
}
impl<T: CliAuthService> CliAuthServiceServer<T> {
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
impl<T> Clone for CliAuthServiceServer<T> {
    fn clone(&self) -> Self {
        Self {
            inner: ::std::sync::Arc::clone(&self.inner),
        }
    }
}
impl<T: CliAuthService> ::connectrpc::Dispatcher for CliAuthServiceServer<T> {
    #[inline]
    fn lookup(
        &self,
        path: &str,
    ) -> Option<::connectrpc::dispatcher::codegen::MethodDescriptor> {
        let method = path.strip_prefix("onequery.cli.v1.CliAuthService/")?;
        match method {
            "GetSession" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "RefreshSession" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "StartDeviceAuthorization" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "PollDeviceAuthorization" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliAuthService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "GetSession" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::GetSessionRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.get_session(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "RefreshSession" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::RefreshSessionRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.refresh_session(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "StartDeviceAuthorization" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::StartDeviceAuthorizationRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.start_device_authorization(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "PollDeviceAuthorization" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::PollDeviceAuthorizationRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.poll_device_authorization(ctx, req).await?;
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliAuthService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliAuthService/") else {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliAuthService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
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
/// let client = CliAuthServiceClient::new(conn, config);
/// let response = client.get_session(request).await?;
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
/// let client = CliAuthServiceClient::new(http, config);
/// let response = client.get_session(request).await?;
/// ```
///
/// # Working with the response
///
/// Unary calls return [`UnaryResponse<OwnedView<FooView>>`](::connectrpc::client::UnaryResponse).
/// The `OwnedView` derefs to the view, so field access is zero-copy:
///
/// ```rust,ignore
/// let resp = client.get_session(request).await?.into_view();
/// let name: &str = resp.name;  // borrow into the response buffer
/// ```
///
/// If you need the owned struct (e.g. to store or pass by value), use
/// [`into_owned()`](::connectrpc::client::UnaryResponse::into_owned):
///
/// ```rust,ignore
/// let owned = client.get_session(request).await?.into_owned();
/// ```
#[derive(Clone)]
pub struct CliAuthServiceClient<T> {
    transport: T,
    config: ::connectrpc::client::ClientConfig,
}
impl<T> CliAuthServiceClient<T>
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
    /// Call the GetSession RPC. Sends a request to /onequery.cli.v1.CliAuthService/GetSession.
    pub async fn get_session(
        &self,
        request: crate::proto::onequery::cli::v1::GetSessionRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetSessionResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.get_session_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the GetSession RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn get_session_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::GetSessionRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetSessionResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "GetSession",
                request,
                options,
            )
            .await
    }
    /// Call the RefreshSession RPC. Sends a request to /onequery.cli.v1.CliAuthService/RefreshSession.
    pub async fn refresh_session(
        &self,
        request: crate::proto::onequery::cli::v1::RefreshSessionRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::RefreshSessionResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.refresh_session_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the RefreshSession RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn refresh_session_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::RefreshSessionRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::RefreshSessionResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "RefreshSession",
                request,
                options,
            )
            .await
    }
    /// Call the StartDeviceAuthorization RPC. Sends a request to /onequery.cli.v1.CliAuthService/StartDeviceAuthorization.
    pub async fn start_device_authorization(
        &self,
        request: crate::proto::onequery::cli::v1::StartDeviceAuthorizationRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::StartDeviceAuthorizationResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.start_device_authorization_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the StartDeviceAuthorization RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn start_device_authorization_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::StartDeviceAuthorizationRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::StartDeviceAuthorizationResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "StartDeviceAuthorization",
                request,
                options,
            )
            .await
    }
    /// Call the PollDeviceAuthorization RPC. Sends a request to /onequery.cli.v1.CliAuthService/PollDeviceAuthorization.
    pub async fn poll_device_authorization(
        &self,
        request: crate::proto::onequery::cli::v1::PollDeviceAuthorizationRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::PollDeviceAuthorizationResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.poll_device_authorization_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the PollDeviceAuthorization RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn poll_device_authorization_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::PollDeviceAuthorizationRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::PollDeviceAuthorizationResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_AUTH_SERVICE_SERVICE_NAME,
                "PollDeviceAuthorization",
                request,
                options,
            )
            .await
    }
}
/// Full service name for this service.
pub const CLI_ORGANIZATION_SERVICE_SERVICE_NAME: &str = "onequery.cli.v1.CliOrganizationService";
/// Server trait for CliOrganizationService.
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
pub trait CliOrganizationService: Send + Sync + 'static {
    /// Handle the ListOrganizations RPC.
    fn list_organizations(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ListOrganizationsRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ListOrganizationsResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the GetOrganization RPC.
    fn get_organization(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::GetOrganizationRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::GetOrganizationResponse,
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
pub trait CliOrganizationServiceExt: CliOrganizationService {
    /// Register this service implementation with a Router.
    ///
    /// Takes ownership of the `Arc<Self>` and returns a new Router with
    /// this service's methods registered.
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router;
}
impl<S: CliOrganizationService> CliOrganizationServiceExt for S {
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router {
        router
            .route_view_idempotent(
                CLI_ORGANIZATION_SERVICE_SERVICE_NAME,
                "ListOrganizations",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.list_organizations(ctx, req).await }
                    })
                },
            )
            .route_view_idempotent(
                CLI_ORGANIZATION_SERVICE_SERVICE_NAME,
                "GetOrganization",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.get_organization(ctx, req).await }
                    })
                },
            )
    }
}
/// Monomorphic dispatcher for `CliOrganizationService`.
///
/// Unlike `.register(Router)` which type-erases each method into an `Arc<dyn ErasedHandler>` stored in a `HashMap`, this struct dispatches via a compile-time `match` on method name: no vtable, no hash lookup.
///
/// # Example
///
/// ```rust,ignore
/// use connectrpc::ConnectRpcService;
///
/// let server = CliOrganizationServiceServer::new(MyImpl);
/// let service = ConnectRpcService::new(server);
/// // hand `service` to axum/hyper as a fallback_service
/// ```
pub struct CliOrganizationServiceServer<T> {
    inner: ::std::sync::Arc<T>,
}
impl<T: CliOrganizationService> CliOrganizationServiceServer<T> {
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
impl<T> Clone for CliOrganizationServiceServer<T> {
    fn clone(&self) -> Self {
        Self {
            inner: ::std::sync::Arc::clone(&self.inner),
        }
    }
}
impl<T: CliOrganizationService> ::connectrpc::Dispatcher
for CliOrganizationServiceServer<T> {
    #[inline]
    fn lookup(
        &self,
        path: &str,
    ) -> Option<::connectrpc::dispatcher::codegen::MethodDescriptor> {
        let method = path.strip_prefix("onequery.cli.v1.CliOrganizationService/")?;
        match method {
            "ListOrganizations" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "GetOrganization" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliOrganizationService/")
        else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "ListOrganizations" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ListOrganizationsRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.list_organizations(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "GetOrganization" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::GetOrganizationRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.get_organization(ctx, req).await?;
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliOrganizationService/")
        else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliOrganizationService/")
        else {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliOrganizationService/")
        else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
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
/// let client = CliOrganizationServiceClient::new(conn, config);
/// let response = client.list_organizations(request).await?;
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
/// let client = CliOrganizationServiceClient::new(http, config);
/// let response = client.list_organizations(request).await?;
/// ```
///
/// # Working with the response
///
/// Unary calls return [`UnaryResponse<OwnedView<FooView>>`](::connectrpc::client::UnaryResponse).
/// The `OwnedView` derefs to the view, so field access is zero-copy:
///
/// ```rust,ignore
/// let resp = client.list_organizations(request).await?.into_view();
/// let name: &str = resp.name;  // borrow into the response buffer
/// ```
///
/// If you need the owned struct (e.g. to store or pass by value), use
/// [`into_owned()`](::connectrpc::client::UnaryResponse::into_owned):
///
/// ```rust,ignore
/// let owned = client.list_organizations(request).await?.into_owned();
/// ```
#[derive(Clone)]
pub struct CliOrganizationServiceClient<T> {
    transport: T,
    config: ::connectrpc::client::ClientConfig,
}
impl<T> CliOrganizationServiceClient<T>
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
    /// Call the ListOrganizations RPC. Sends a request to /onequery.cli.v1.CliOrganizationService/ListOrganizations.
    pub async fn list_organizations(
        &self,
        request: crate::proto::onequery::cli::v1::ListOrganizationsRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ListOrganizationsResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.list_organizations_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ListOrganizations RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn list_organizations_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ListOrganizationsRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ListOrganizationsResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_ORGANIZATION_SERVICE_SERVICE_NAME,
                "ListOrganizations",
                request,
                options,
            )
            .await
    }
    /// Call the GetOrganization RPC. Sends a request to /onequery.cli.v1.CliOrganizationService/GetOrganization.
    pub async fn get_organization(
        &self,
        request: crate::proto::onequery::cli::v1::GetOrganizationRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetOrganizationResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.get_organization_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the GetOrganization RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn get_organization_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::GetOrganizationRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetOrganizationResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_ORGANIZATION_SERVICE_SERVICE_NAME,
                "GetOrganization",
                request,
                options,
            )
            .await
    }
}
/// Full service name for this service.
pub const CLI_SOURCE_SERVICE_SERVICE_NAME: &str = "onequery.cli.v1.CliSourceService";
/// Server trait for CliSourceService.
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
pub trait CliSourceService: Send + Sync + 'static {
    /// Handle the ListSourceProviders RPC.
    fn list_source_providers(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ListSourceProvidersRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ListSourceProvidersResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the ListSources RPC.
    fn list_sources(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ListSourcesRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ListSourcesResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the GetSourceConnectGuide RPC.
    fn get_source_connect_guide(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::GetSourceConnectGuideRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::GetSourceConnectGuideResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the ConnectSource RPC.
    fn connect_source(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ConnectSourceRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ConnectSourceResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the GetSource RPC.
    fn get_source(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::GetSourceRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (crate::proto::onequery::cli::v1::GetSourceResponse, ::connectrpc::Context),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the TestSource RPC.
    fn test_source(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::TestSourceRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (crate::proto::onequery::cli::v1::TestSourceResponse, ::connectrpc::Context),
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
pub trait CliSourceServiceExt: CliSourceService {
    /// Register this service implementation with a Router.
    ///
    /// Takes ownership of the `Arc<Self>` and returns a new Router with
    /// this service's methods registered.
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router;
}
impl<S: CliSourceService> CliSourceServiceExt for S {
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router {
        router
            .route_view_idempotent(
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "ListSourceProviders",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.list_source_providers(ctx, req).await }
                    })
                },
            )
            .route_view_idempotent(
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "ListSources",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.list_sources(ctx, req).await }
                    })
                },
            )
            .route_view_idempotent(
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "GetSourceConnectGuide",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.get_source_connect_guide(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "ConnectSource",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.connect_source(ctx, req).await }
                    })
                },
            )
            .route_view_idempotent(
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "GetSource",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.get_source(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "TestSource",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.test_source(ctx, req).await }
                    })
                },
            )
    }
}
/// Monomorphic dispatcher for `CliSourceService`.
///
/// Unlike `.register(Router)` which type-erases each method into an `Arc<dyn ErasedHandler>` stored in a `HashMap`, this struct dispatches via a compile-time `match` on method name: no vtable, no hash lookup.
///
/// # Example
///
/// ```rust,ignore
/// use connectrpc::ConnectRpcService;
///
/// let server = CliSourceServiceServer::new(MyImpl);
/// let service = ConnectRpcService::new(server);
/// // hand `service` to axum/hyper as a fallback_service
/// ```
pub struct CliSourceServiceServer<T> {
    inner: ::std::sync::Arc<T>,
}
impl<T: CliSourceService> CliSourceServiceServer<T> {
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
impl<T> Clone for CliSourceServiceServer<T> {
    fn clone(&self) -> Self {
        Self {
            inner: ::std::sync::Arc::clone(&self.inner),
        }
    }
}
impl<T: CliSourceService> ::connectrpc::Dispatcher for CliSourceServiceServer<T> {
    #[inline]
    fn lookup(
        &self,
        path: &str,
    ) -> Option<::connectrpc::dispatcher::codegen::MethodDescriptor> {
        let method = path.strip_prefix("onequery.cli.v1.CliSourceService/")?;
        match method {
            "ListSourceProviders" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "ListSources" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "GetSourceConnectGuide" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "ConnectSource" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "GetSource" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(true))
            }
            "TestSource" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "ListSourceProviders" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ListSourceProvidersRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.list_source_providers(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "ListSources" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ListSourcesRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.list_sources(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "GetSourceConnectGuide" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::GetSourceConnectGuideRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.get_source_connect_guide(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "ConnectSource" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ConnectSourceRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.connect_source(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "GetSource" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::GetSourceRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.get_source(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "TestSource" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::TestSourceRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.test_source(ctx, req).await?;
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceService/") else {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
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
/// let client = CliSourceServiceClient::new(conn, config);
/// let response = client.list_source_providers(request).await?;
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
/// let client = CliSourceServiceClient::new(http, config);
/// let response = client.list_source_providers(request).await?;
/// ```
///
/// # Working with the response
///
/// Unary calls return [`UnaryResponse<OwnedView<FooView>>`](::connectrpc::client::UnaryResponse).
/// The `OwnedView` derefs to the view, so field access is zero-copy:
///
/// ```rust,ignore
/// let resp = client.list_source_providers(request).await?.into_view();
/// let name: &str = resp.name;  // borrow into the response buffer
/// ```
///
/// If you need the owned struct (e.g. to store or pass by value), use
/// [`into_owned()`](::connectrpc::client::UnaryResponse::into_owned):
///
/// ```rust,ignore
/// let owned = client.list_source_providers(request).await?.into_owned();
/// ```
#[derive(Clone)]
pub struct CliSourceServiceClient<T> {
    transport: T,
    config: ::connectrpc::client::ClientConfig,
}
impl<T> CliSourceServiceClient<T>
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
    /// Call the ListSourceProviders RPC. Sends a request to /onequery.cli.v1.CliSourceService/ListSourceProviders.
    pub async fn list_source_providers(
        &self,
        request: crate::proto::onequery::cli::v1::ListSourceProvidersRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ListSourceProvidersResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.list_source_providers_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ListSourceProviders RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn list_source_providers_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ListSourceProvidersRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ListSourceProvidersResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "ListSourceProviders",
                request,
                options,
            )
            .await
    }
    /// Call the ListSources RPC. Sends a request to /onequery.cli.v1.CliSourceService/ListSources.
    pub async fn list_sources(
        &self,
        request: crate::proto::onequery::cli::v1::ListSourcesRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ListSourcesResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.list_sources_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ListSources RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn list_sources_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ListSourcesRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ListSourcesResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "ListSources",
                request,
                options,
            )
            .await
    }
    /// Call the GetSourceConnectGuide RPC. Sends a request to /onequery.cli.v1.CliSourceService/GetSourceConnectGuide.
    pub async fn get_source_connect_guide(
        &self,
        request: crate::proto::onequery::cli::v1::GetSourceConnectGuideRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetSourceConnectGuideResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.get_source_connect_guide_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the GetSourceConnectGuide RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn get_source_connect_guide_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::GetSourceConnectGuideRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetSourceConnectGuideResponseView<
                    'static,
                >,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "GetSourceConnectGuide",
                request,
                options,
            )
            .await
    }
    /// Call the ConnectSource RPC. Sends a request to /onequery.cli.v1.CliSourceService/ConnectSource.
    pub async fn connect_source(
        &self,
        request: crate::proto::onequery::cli::v1::ConnectSourceRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ConnectSourceResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.connect_source_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ConnectSource RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn connect_source_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ConnectSourceRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ConnectSourceResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "ConnectSource",
                request,
                options,
            )
            .await
    }
    /// Call the GetSource RPC. Sends a request to /onequery.cli.v1.CliSourceService/GetSource.
    pub async fn get_source(
        &self,
        request: crate::proto::onequery::cli::v1::GetSourceRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetSourceResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.get_source_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the GetSource RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn get_source_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::GetSourceRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::GetSourceResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "GetSource",
                request,
                options,
            )
            .await
    }
    /// Call the TestSource RPC. Sends a request to /onequery.cli.v1.CliSourceService/TestSource.
    pub async fn test_source(
        &self,
        request: crate::proto::onequery::cli::v1::TestSourceRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::TestSourceResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.test_source_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the TestSource RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn test_source_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::TestSourceRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::TestSourceResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_SERVICE_SERVICE_NAME,
                "TestSource",
                request,
                options,
            )
            .await
    }
}
/// Full service name for this service.
pub const CLI_SOURCE_API_SERVICE_SERVICE_NAME: &str = "onequery.cli.v1.CliSourceApiService";
/// Server trait for CliSourceApiService.
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
pub trait CliSourceApiService: Send + Sync + 'static {
    /// Handle the DescribeSourceApi RPC.
    fn describe_source_api(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::DescribeSourceApiRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::DescribeSourceApiResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the PreviewSourceApi RPC.
    fn preview_source_api(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::PreviewSourceApiRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::PreviewSourceApiResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the ExecuteSourceApi RPC.
    fn execute_source_api(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ExecuteSourceApiRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ExecuteSourceApiResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the ResumeSourceApi RPC.
    fn resume_source_api(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ResumeSourceApiRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ResumeSourceApiResponse,
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
pub trait CliSourceApiServiceExt: CliSourceApiService {
    /// Register this service implementation with a Router.
    ///
    /// Takes ownership of the `Arc<Self>` and returns a new Router with
    /// this service's methods registered.
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router;
}
impl<S: CliSourceApiService> CliSourceApiServiceExt for S {
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router {
        router
            .route_view(
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "DescribeSourceApi",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.describe_source_api(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "PreviewSourceApi",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.preview_source_api(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "ExecuteSourceApi",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.execute_source_api(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "ResumeSourceApi",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.resume_source_api(ctx, req).await }
                    })
                },
            )
    }
}
/// Monomorphic dispatcher for `CliSourceApiService`.
///
/// Unlike `.register(Router)` which type-erases each method into an `Arc<dyn ErasedHandler>` stored in a `HashMap`, this struct dispatches via a compile-time `match` on method name: no vtable, no hash lookup.
///
/// # Example
///
/// ```rust,ignore
/// use connectrpc::ConnectRpcService;
///
/// let server = CliSourceApiServiceServer::new(MyImpl);
/// let service = ConnectRpcService::new(server);
/// // hand `service` to axum/hyper as a fallback_service
/// ```
pub struct CliSourceApiServiceServer<T> {
    inner: ::std::sync::Arc<T>,
}
impl<T: CliSourceApiService> CliSourceApiServiceServer<T> {
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
impl<T> Clone for CliSourceApiServiceServer<T> {
    fn clone(&self) -> Self {
        Self {
            inner: ::std::sync::Arc::clone(&self.inner),
        }
    }
}
impl<T: CliSourceApiService> ::connectrpc::Dispatcher for CliSourceApiServiceServer<T> {
    #[inline]
    fn lookup(
        &self,
        path: &str,
    ) -> Option<::connectrpc::dispatcher::codegen::MethodDescriptor> {
        let method = path.strip_prefix("onequery.cli.v1.CliSourceApiService/")?;
        match method {
            "DescribeSourceApi" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "PreviewSourceApi" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "ExecuteSourceApi" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "ResumeSourceApi" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceApiService/")
        else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "DescribeSourceApi" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::DescribeSourceApiRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.describe_source_api(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "PreviewSourceApi" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::PreviewSourceApiRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.preview_source_api(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "ExecuteSourceApi" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ExecuteSourceApiRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.execute_source_api(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "ResumeSourceApi" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ResumeSourceApiRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.resume_source_api(ctx, req).await?;
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceApiService/")
        else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceApiService/")
        else {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliSourceApiService/")
        else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
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
/// let client = CliSourceApiServiceClient::new(conn, config);
/// let response = client.describe_source_api(request).await?;
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
/// let client = CliSourceApiServiceClient::new(http, config);
/// let response = client.describe_source_api(request).await?;
/// ```
///
/// # Working with the response
///
/// Unary calls return [`UnaryResponse<OwnedView<FooView>>`](::connectrpc::client::UnaryResponse).
/// The `OwnedView` derefs to the view, so field access is zero-copy:
///
/// ```rust,ignore
/// let resp = client.describe_source_api(request).await?.into_view();
/// let name: &str = resp.name;  // borrow into the response buffer
/// ```
///
/// If you need the owned struct (e.g. to store or pass by value), use
/// [`into_owned()`](::connectrpc::client::UnaryResponse::into_owned):
///
/// ```rust,ignore
/// let owned = client.describe_source_api(request).await?.into_owned();
/// ```
#[derive(Clone)]
pub struct CliSourceApiServiceClient<T> {
    transport: T,
    config: ::connectrpc::client::ClientConfig,
}
impl<T> CliSourceApiServiceClient<T>
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
    /// Call the DescribeSourceApi RPC. Sends a request to /onequery.cli.v1.CliSourceApiService/DescribeSourceApi.
    pub async fn describe_source_api(
        &self,
        request: crate::proto::onequery::cli::v1::DescribeSourceApiRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::DescribeSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.describe_source_api_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the DescribeSourceApi RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn describe_source_api_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::DescribeSourceApiRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::DescribeSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "DescribeSourceApi",
                request,
                options,
            )
            .await
    }
    /// Call the PreviewSourceApi RPC. Sends a request to /onequery.cli.v1.CliSourceApiService/PreviewSourceApi.
    pub async fn preview_source_api(
        &self,
        request: crate::proto::onequery::cli::v1::PreviewSourceApiRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::PreviewSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.preview_source_api_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the PreviewSourceApi RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn preview_source_api_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::PreviewSourceApiRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::PreviewSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "PreviewSourceApi",
                request,
                options,
            )
            .await
    }
    /// Call the ExecuteSourceApi RPC. Sends a request to /onequery.cli.v1.CliSourceApiService/ExecuteSourceApi.
    pub async fn execute_source_api(
        &self,
        request: crate::proto::onequery::cli::v1::ExecuteSourceApiRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ExecuteSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.execute_source_api_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ExecuteSourceApi RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn execute_source_api_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ExecuteSourceApiRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ExecuteSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "ExecuteSourceApi",
                request,
                options,
            )
            .await
    }
    /// Call the ResumeSourceApi RPC. Sends a request to /onequery.cli.v1.CliSourceApiService/ResumeSourceApi.
    pub async fn resume_source_api(
        &self,
        request: crate::proto::onequery::cli::v1::ResumeSourceApiRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ResumeSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.resume_source_api_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ResumeSourceApi RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn resume_source_api_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ResumeSourceApiRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ResumeSourceApiResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_SOURCE_API_SERVICE_SERVICE_NAME,
                "ResumeSourceApi",
                request,
                options,
            )
            .await
    }
}
/// Full service name for this service.
pub const CLI_QUERY_SERVICE_SERVICE_NAME: &str = "onequery.cli.v1.CliQueryService";
/// Server trait for CliQueryService.
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
pub trait CliQueryService: Send + Sync + 'static {
    /// Handle the ValidateQuery RPC.
    fn validate_query(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ValidateQueryRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ValidateQueryResponse,
                ::connectrpc::Context,
            ),
            ::connectrpc::ConnectError,
        >,
    > + Send;
    /// Handle the ExecuteQuery RPC.
    fn execute_query(
        &self,
        ctx: ::connectrpc::Context,
        request: ::buffa::view::OwnedView<
            crate::proto::onequery::cli::v1::ExecuteQueryRequestView<'static>,
        >,
    ) -> impl ::std::future::Future<
        Output = Result<
            (
                crate::proto::onequery::cli::v1::ExecuteQueryResponse,
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
pub trait CliQueryServiceExt: CliQueryService {
    /// Register this service implementation with a Router.
    ///
    /// Takes ownership of the `Arc<Self>` and returns a new Router with
    /// this service's methods registered.
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router;
}
impl<S: CliQueryService> CliQueryServiceExt for S {
    fn register(
        self: ::std::sync::Arc<Self>,
        router: ::connectrpc::Router,
    ) -> ::connectrpc::Router {
        router
            .route_view(
                CLI_QUERY_SERVICE_SERVICE_NAME,
                "ValidateQuery",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.validate_query(ctx, req).await }
                    })
                },
            )
            .route_view(
                CLI_QUERY_SERVICE_SERVICE_NAME,
                "ExecuteQuery",
                {
                    let svc = ::std::sync::Arc::clone(&self);
                    ::connectrpc::view_handler_fn(move |ctx, req| {
                        let svc = ::std::sync::Arc::clone(&svc);
                        async move { svc.execute_query(ctx, req).await }
                    })
                },
            )
    }
}
/// Monomorphic dispatcher for `CliQueryService`.
///
/// Unlike `.register(Router)` which type-erases each method into an `Arc<dyn ErasedHandler>` stored in a `HashMap`, this struct dispatches via a compile-time `match` on method name: no vtable, no hash lookup.
///
/// # Example
///
/// ```rust,ignore
/// use connectrpc::ConnectRpcService;
///
/// let server = CliQueryServiceServer::new(MyImpl);
/// let service = ConnectRpcService::new(server);
/// // hand `service` to axum/hyper as a fallback_service
/// ```
pub struct CliQueryServiceServer<T> {
    inner: ::std::sync::Arc<T>,
}
impl<T: CliQueryService> CliQueryServiceServer<T> {
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
impl<T> Clone for CliQueryServiceServer<T> {
    fn clone(&self) -> Self {
        Self {
            inner: ::std::sync::Arc::clone(&self.inner),
        }
    }
}
impl<T: CliQueryService> ::connectrpc::Dispatcher for CliQueryServiceServer<T> {
    #[inline]
    fn lookup(
        &self,
        path: &str,
    ) -> Option<::connectrpc::dispatcher::codegen::MethodDescriptor> {
        let method = path.strip_prefix("onequery.cli.v1.CliQueryService/")?;
        match method {
            "ValidateQuery" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
            }
            "ExecuteQuery" => {
                Some(::connectrpc::dispatcher::codegen::MethodDescriptor::unary(false))
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliQueryService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_unary(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
            "ValidateQuery" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ValidateQueryRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.validate_query(ctx, req).await?;
                    let bytes = ::connectrpc::dispatcher::codegen::encode_response(
                        &res,
                        format,
                    )?;
                    Ok((bytes, ctx))
                })
            }
            "ExecuteQuery" => {
                let svc = ::std::sync::Arc::clone(&self.inner);
                Box::pin(async move {
                    let req = ::connectrpc::dispatcher::codegen::decode_request_view::<
                        crate::proto::onequery::cli::v1::ExecuteQueryRequestView,
                    >(request, format)?;
                    let (res, ctx) = svc.execute_query(ctx, req).await?;
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliQueryService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &request, &format);
        match method {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliQueryService/") else {
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
        let Some(method) = path.strip_prefix("onequery.cli.v1.CliQueryService/") else {
            return ::connectrpc::dispatcher::codegen::unimplemented_streaming(path);
        };
        let _ = (&ctx, &requests, &format);
        match method {
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
/// let client = CliQueryServiceClient::new(conn, config);
/// let response = client.validate_query(request).await?;
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
/// let client = CliQueryServiceClient::new(http, config);
/// let response = client.validate_query(request).await?;
/// ```
///
/// # Working with the response
///
/// Unary calls return [`UnaryResponse<OwnedView<FooView>>`](::connectrpc::client::UnaryResponse).
/// The `OwnedView` derefs to the view, so field access is zero-copy:
///
/// ```rust,ignore
/// let resp = client.validate_query(request).await?.into_view();
/// let name: &str = resp.name;  // borrow into the response buffer
/// ```
///
/// If you need the owned struct (e.g. to store or pass by value), use
/// [`into_owned()`](::connectrpc::client::UnaryResponse::into_owned):
///
/// ```rust,ignore
/// let owned = client.validate_query(request).await?.into_owned();
/// ```
#[derive(Clone)]
pub struct CliQueryServiceClient<T> {
    transport: T,
    config: ::connectrpc::client::ClientConfig,
}
impl<T> CliQueryServiceClient<T>
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
    /// Call the ValidateQuery RPC. Sends a request to /onequery.cli.v1.CliQueryService/ValidateQuery.
    pub async fn validate_query(
        &self,
        request: crate::proto::onequery::cli::v1::ValidateQueryRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ValidateQueryResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.validate_query_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ValidateQuery RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn validate_query_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ValidateQueryRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ValidateQueryResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_QUERY_SERVICE_SERVICE_NAME,
                "ValidateQuery",
                request,
                options,
            )
            .await
    }
    /// Call the ExecuteQuery RPC. Sends a request to /onequery.cli.v1.CliQueryService/ExecuteQuery.
    pub async fn execute_query(
        &self,
        request: crate::proto::onequery::cli::v1::ExecuteQueryRequest,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ExecuteQueryResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        self.execute_query_with_options(
                request,
                ::connectrpc::client::CallOptions::default(),
            )
            .await
    }
    /// Call the ExecuteQuery RPC with explicit per-call options. Options override [`ClientConfig`](::connectrpc::client::ClientConfig) defaults.
    pub async fn execute_query_with_options(
        &self,
        request: crate::proto::onequery::cli::v1::ExecuteQueryRequest,
        options: ::connectrpc::client::CallOptions,
    ) -> Result<
        ::connectrpc::client::UnaryResponse<
            ::buffa::view::OwnedView<
                crate::proto::onequery::cli::v1::ExecuteQueryResponseView<'static>,
            >,
        >,
        ::connectrpc::ConnectError,
    > {
        ::connectrpc::client::call_unary(
                &self.transport,
                &self.config,
                CLI_QUERY_SERVICE_SERVICE_NAME,
                "ExecuteQuery",
                request,
                options,
            )
            .await
    }
}
