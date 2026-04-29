use std::any::Any;
use std::error::Error;
use std::io;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use connectrpc::ConnectRpcService;
use connectrpc::Limits;
use futures::FutureExt;
use hyper::service::service_fn;
use hyper_util::rt::TokioExecutor;
use hyper_util::rt::TokioIo;
use hyper_util::server::conn::auto::Builder;
use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleServiceServer;
use tokio::net::UnixListener;
use tokio::net::UnixStream;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::task::JoinSet;
use tower::Service;

use super::service::SupervisorControlService;
use crate::supervisor_control_protocol::SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES;

type SupervisorControlServerResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SocketFileIdentity {
    dev: u64,
    ino: u64,
    mtime: i64,
    mtime_nsec: i64,
    ctime: i64,
    ctime_nsec: i64,
}

pub(super) fn connect_service(
    service: SupervisorControlService,
) -> SupervisorLifecycleServiceServer<SupervisorControlService> {
    SupervisorLifecycleServiceServer::new(service)
}

pub(crate) struct SupervisorControlServer {
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<SupervisorControlServerResult<()>>,
}

impl SupervisorControlServer {
    /// Stop accepting supervisor control connections.
    ///
    /// Shutdown deliberately aborts active connection tasks instead of draining
    /// them. Runtime sessions are long-lived bidi streams, and supervisor
    /// process shutdown must be bounded so socket cleanup cannot wait on a
    /// runtime that is already exiting or unresponsive.
    pub(crate) async fn stop(mut self) -> SupervisorControlServerResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }

        self.task
            .await
            .map_err(Box::<dyn Error + Send + Sync>::from)?
    }
}

pub(crate) async fn start_supervisor_control_server(
    socket_path: PathBuf,
    service: SupervisorControlService,
) -> SupervisorControlServerResult<SupervisorControlServer> {
    prepare_socket_path(socket_path.as_path()).await?;
    let listener = UnixListener::bind(socket_path.as_path())?;
    set_socket_permissions(socket_path.as_path())?;
    let socket_file = socket_file_identity(socket_path.as_path()).await?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task_socket_path = socket_path.clone();
    let task = tokio::spawn(async move {
        run_supervisor_control_server(
            listener,
            service,
            shutdown_rx,
            task_socket_path,
            socket_file,
        )
        .await
    });

    Ok(SupervisorControlServer {
        shutdown: Some(shutdown_tx),
        task,
    })
}

async fn run_supervisor_control_server(
    listener: UnixListener,
    service: SupervisorControlService,
    shutdown: oneshot::Receiver<()>,
    socket_path: PathBuf,
    socket_file: SocketFileIdentity,
) -> SupervisorControlServerResult<()> {
    let serve_result = AssertUnwindSafe(serve_unix_listener(listener, service, shutdown))
        .catch_unwind()
        .await
        .map_err(|panic| panic_error("supervisor control server", panic))
        .and_then(|result| result);
    let cleanup_result = remove_socket_file_if_matches(socket_path.as_path(), socket_file)
        .await
        .map_err(Box::<dyn Error + Send + Sync>::from);

    match (serve_result, cleanup_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Err(error), Err(cleanup_error)) => {
            tracing::warn!(
                error = %cleanup_error,
                socket_path = %socket_path.display(),
                "failed to remove supervisor control socket after server error"
            );
            Err(error)
        }
    }
}

async fn serve_unix_listener(
    listener: UnixListener,
    service: SupervisorControlService,
    mut shutdown: oneshot::Receiver<()>,
) -> SupervisorControlServerResult<()> {
    let limits = Limits::default()
        .max_message_size(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES)
        .max_request_body_size(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES);
    // Comment: Connect Rust does not currently wire a Protovalidate interceptor
    // for these buf.validate-heavy runtime protos. Keep supervisor handlers
    // focused on stateful lifecycle checks; schema-level required/range checks
    // belong in the proto contract to avoid duplicate Rust validation logic.
    let service = Arc::new(ConnectRpcService::new(connect_service(service)).with_limits(limits));
    let mut connections = JoinSet::new();

    loop {
        tokio::select! {
            biased;

            _ = &mut shutdown => break,
            joined = connections.join_next(), if !connections.is_empty() => {
                if let Some(result) = joined {
                    handle_connection_result(result)?;
                }
            }
            accepted = listener.accept() => {
                let stream = accepted?.0;
                let service = Arc::clone(&service);
                connections.spawn(async move { serve_unix_stream(stream, service).await });
            },
        }
    }

    connections.abort_all();
    while let Some(result) = connections.join_next().await {
        handle_connection_result(result)?;
    }

    Ok(())
}

fn handle_connection_result(
    result: Result<SupervisorControlServerResult<()>, tokio::task::JoinError>,
) -> SupervisorControlServerResult<()> {
    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => {
            tracing::debug!(error = %error, "supervisor control connection ended with error");
            Ok(())
        }
        Err(error) if error.is_cancelled() => Ok(()),
        Err(error) if error.is_panic() => {
            tracing::error!(
                error = %error,
                "supervisor control connection task panicked"
            );
            Ok(())
        }
        Err(error) => Err(Box::new(error)),
    }
}

async fn serve_unix_stream(
    stream: UnixStream,
    service: Arc<ConnectRpcService<SupervisorLifecycleServiceServer<SupervisorControlService>>>,
) -> SupervisorControlServerResult<()> {
    let svc = service_fn(move |request| {
        let mut service = (*service).clone();
        async move { service.call(request).await }
    });

    Builder::new(TokioExecutor::new())
        .serve_connection(TokioIo::new(stream), svc)
        .await?;

    Ok(())
}

fn panic_error(context: &'static str, panic: Box<dyn Any + Send>) -> Box<dyn Error + Send + Sync> {
    Box::new(io::Error::other(format!(
        "{context} panicked: {}",
        panic_payload_message(panic.as_ref())
    )))
}

fn panic_payload_message(panic: &(dyn Any + Send)) -> String {
    if let Some(message) = panic.downcast_ref::<String>() {
        message.clone()
    } else if let Some(message) = panic.downcast_ref::<&str>() {
        (*message).to_owned()
    } else {
        "unknown panic payload".to_owned()
    }
}

async fn prepare_socket_path(socket_path: &Path) -> io::Result<()> {
    let Some(parent) = socket_path.parent() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("socket path has no parent: {}", socket_path.display()),
        ));
    };

    tokio::fs::create_dir_all(parent).await?;
    set_parent_directory_permissions(parent)?;
    remove_stale_socket(socket_path).await
}

#[cfg(unix)]
fn set_parent_directory_permissions(parent: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_parent_directory_permissions(_parent: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "supervisor control is not supported on Windows yet",
    ))
}

#[cfg(unix)]
fn set_socket_permissions(socket_path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_socket_permissions(_socket_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "supervisor control is not supported on Windows yet",
    ))
}

async fn remove_stale_socket(socket_path: &Path) -> io::Result<()> {
    let metadata = match tokio::fs::symlink_metadata(socket_path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    if !is_socket_file(&metadata) {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!(
                "supervisor control socket path exists and is not a socket: {}",
                socket_path.display()
            ),
        ));
    }

    match UnixStream::connect(socket_path).await {
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            format!(
                "supervisor control socket is already active: {}",
                socket_path.display()
            ),
        )),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound
            ) =>
        {
            remove_socket_file(socket_path).await
        }
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn is_socket_file(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::FileTypeExt;

    metadata.file_type().is_socket()
}

#[cfg(not(unix))]
fn is_socket_file(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
async fn socket_file_identity(socket_path: &Path) -> io::Result<SocketFileIdentity> {
    let metadata = tokio::fs::symlink_metadata(socket_path).await?;
    Ok(socket_file_identity_from_metadata(&metadata))
}

#[cfg(unix)]
fn socket_file_identity_from_metadata(metadata: &std::fs::Metadata) -> SocketFileIdentity {
    use std::os::unix::fs::MetadataExt;

    SocketFileIdentity {
        dev: metadata.dev(),
        ino: metadata.ino(),
        mtime: metadata.mtime(),
        mtime_nsec: metadata.mtime_nsec(),
        ctime: metadata.ctime(),
        ctime_nsec: metadata.ctime_nsec(),
    }
}

#[cfg(not(unix))]
async fn socket_file_identity(_socket_path: &Path) -> io::Result<SocketFileIdentity> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "supervisor control is not supported on Windows yet",
    ))
}

#[cfg(unix)]
async fn remove_socket_file_if_matches(
    socket_path: &Path,
    expected: SocketFileIdentity,
) -> io::Result<()> {
    let metadata = match tokio::fs::symlink_metadata(socket_path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if socket_file_identity_from_metadata(&metadata) != expected {
        tracing::debug!(
            socket_path = %socket_path.display(),
            "skipping supervisor control socket cleanup because path was rebound"
        );
        return Ok(());
    }

    remove_socket_file(socket_path).await
}

#[cfg(not(unix))]
async fn remove_socket_file_if_matches(
    _socket_path: &Path,
    _expected: SocketFileIdentity,
) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "supervisor control is not supported on Windows yet",
    ))
}

async fn remove_socket_file(socket_path: &Path) -> io::Result<()> {
    match tokio::fs::remove_file(socket_path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    use buffa::MessageField;
    use connectrpc::client::ClientConfig;
    use connectrpc::client::Http2Connection;
    use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleServiceClient;
    use pretty_assertions::assert_eq;
    use tokio::time::timeout;

    use super::*;
    use crate::supervisor_control_proto::types;
    use crate::supervisor_control_protocol::SUPERVISOR_CONTROL_AUTHORITY;

    const SHARED_STREAM_BOUND: usize = 8;

    #[tokio::test]
    async fn server_sets_parent_directory_and_socket_permissions() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        let server = start_supervisor_control_server(socket_path.clone(), test_service(1))
            .await
            .unwrap();

        let parent_mode = std::fs::metadata(socket_path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let socket_mode = std::fs::metadata(socket_path.as_path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(parent_mode, 0o700);
        assert_eq!(socket_mode, 0o600);

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn server_removes_stale_socket_before_binding() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        tokio::fs::create_dir_all(socket_path.parent().unwrap())
            .await
            .unwrap();
        let stale_listener = UnixListener::bind(socket_path.as_path()).unwrap();
        drop(stale_listener);

        let server = start_supervisor_control_server(socket_path.clone(), test_service(9))
            .await
            .unwrap();
        let status = get_status(socket_path.as_path()).await;

        assert_eq!(status.supervisor_sequence, Some(9));

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn server_stop_aborts_active_connections_and_removes_socket() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        let server = start_supervisor_control_server(socket_path.clone(), test_service(7))
            .await
            .unwrap();
        let client = supervisor_client(socket_path.as_path()).await;
        let mut session = client.open_runtime_session().await.unwrap();
        session
            .send(types::OpenRuntimeSessionRequest {
                payload: Some(types::open_runtime_session_request::Payload::Hello(
                    Box::new(test_session_hello()),
                )),
                ..Default::default()
            })
            .await
            .unwrap();

        timeout(Duration::from_secs(1), server.stop())
            .await
            .expect("server stop should not wait forever for active sessions")
            .expect("server stop should succeed");

        assert!(!socket_path.exists());
        let connect_error = UnixStream::connect(socket_path.as_path())
            .await
            .expect_err("stopped server socket should not accept connections");
        assert_eq!(connect_error.kind(), io::ErrorKind::NotFound);
    }

    #[tokio::test]
    async fn socket_cleanup_skips_rebound_socket_path() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        tokio::fs::create_dir_all(socket_path.parent().unwrap())
            .await
            .unwrap();
        let old_listener = UnixListener::bind(socket_path.as_path()).unwrap();
        let old_socket_file = socket_file_identity(socket_path.as_path()).await.unwrap();
        drop(old_listener);
        remove_socket_file(socket_path.as_path()).await.unwrap();

        let new_listener = UnixListener::bind(socket_path.as_path()).unwrap();
        let rebound_socket_file = socket_file_identity(socket_path.as_path()).await.unwrap();
        assert_ne!(rebound_socket_file, old_socket_file);

        remove_socket_file_if_matches(socket_path.as_path(), old_socket_file)
            .await
            .unwrap();

        assert!(socket_path.exists());
        drop(new_listener);
        remove_socket_file(socket_path.as_path()).await.unwrap();
    }

    #[tokio::test]
    async fn server_rejects_active_socket() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        tokio::fs::create_dir_all(socket_path.parent().unwrap())
            .await
            .unwrap();
        let _active_listener = UnixListener::bind(socket_path.as_path()).unwrap();

        let error = match start_supervisor_control_server(socket_path, test_service(1)).await {
            Ok(server) => {
                server.stop().await.unwrap();
                panic!("expected active socket to be rejected");
            }
            Err(error) => error,
        };

        let io_error = error.downcast_ref::<io::Error>().unwrap();
        assert_eq!(io_error.kind(), io::ErrorKind::AddrInUse);
    }

    async fn get_status(socket_path: &Path) -> types::SupervisorStatus {
        let client = supervisor_client(socket_path).await;
        let response = client
            .get_status(types::SupervisorLifecycleServiceGetStatusRequest {
                ..Default::default()
            })
            .await
            .unwrap_or_else(|error| panic!("expected get_status response: {error}"))
            .into_owned();

        match response.status.into_option() {
            Some(status) => status,
            None => panic!("expected get_status response status"),
        }
    }

    async fn supervisor_client(
        socket_path: &Path,
    ) -> SupervisorLifecycleServiceClient<connectrpc::client::SharedHttp2Connection> {
        let authority: http::Uri = SUPERVISOR_CONTROL_AUTHORITY
            .parse()
            .unwrap_or_else(|error| panic!("expected supervisor control authority URI: {error}"));
        let connection = Http2Connection::connect_unix(socket_path, authority.clone())
            .await
            .unwrap_or_else(|error| panic!("expected supervisor control connection: {error}"));
        SupervisorLifecycleServiceClient::new(
            connection.shared(SHARED_STREAM_BOUND),
            ClientConfig::new(authority),
        )
    }

    fn test_service(sequence: u64) -> SupervisorControlService {
        SupervisorControlService::new(test_actor(sequence))
    }

    fn test_actor(sequence: u64) -> super::super::actor::SupervisorControlActor {
        super::super::actor::SupervisorControlActor::new(types::SupervisorStatus {
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
                pid: Some(4242),
                launch_id: Some("launch-a".to_owned()),
                data_dir: Some("/tmp/onequery-data".to_owned()),
                ..Default::default()
            }),
            active_session: Some(false),
            ..Default::default()
        })
    }

    fn test_session_hello() -> types::RuntimeSessionHello {
        types::RuntimeSessionHello {
            launch_id: Some("launch-a".to_owned()),
            data_dir: Some("/tmp/onequery-data".to_owned()),
            runtime_pid: Some(4242),
            supervisor: MessageField::some(types::SupervisorIdentity {
                supervisor_id: Some("gateway-supervisor:test".to_owned()),
                pid: Some(1),
                generation: Some(1),
                ..Default::default()
            }),
            ..Default::default()
        }
    }
}
