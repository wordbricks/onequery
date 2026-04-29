use std::error::Error;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use connectrpc::ConnectRpcService;
use connectrpc::Limits;
use hyper::service::service_fn;
use hyper_util::rt::TokioExecutor;
use hyper_util::rt::TokioIo;
use hyper_util::server::conn::auto::Builder;
use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleServiceServer;
use tokio::net::UnixListener;
use tokio::net::UnixStream;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower::Service;

use super::service::SupervisorControlService;

type SupervisorControlServerResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
const SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES: usize = 64 * 1024;

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

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task_socket_path = socket_path.clone();
    let task = tokio::spawn(async move {
        let result = serve_unix_listener(listener, service, shutdown_rx).await;
        remove_socket_file(task_socket_path.as_path()).await?;
        result
    });

    Ok(SupervisorControlServer {
        shutdown: Some(shutdown_tx),
        task,
    })
}

async fn serve_unix_listener(
    listener: UnixListener,
    service: SupervisorControlService,
    mut shutdown: oneshot::Receiver<()>,
) -> SupervisorControlServerResult<()> {
    let limits = Limits::default()
        .max_message_size(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES)
        .max_request_body_size(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES);
    let service = Arc::new(ConnectRpcService::new(connect_service(service)).with_limits(limits));

    loop {
        let stream = tokio::select! {
            biased;

            _ = &mut shutdown => break,
            accepted = listener.accept() => accepted?.0,
        };

        let service = Arc::clone(&service);
        tokio::spawn(async move {
            if let Err(error) = serve_unix_stream(stream, service).await {
                tracing::debug!(error = %error, "supervisor control connection ended with error");
            }
        });
    }

    Ok(())
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
        "supervisor control Unix sockets are not available on this platform",
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
        "supervisor control Unix sockets are not available on this platform",
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
    use connectrpc::error::ErrorCode;
    use onequery_proto_runtime::onequery::runtime::v1::SupervisorLifecycleServiceClient;
    use pretty_assertions::assert_eq;
    use tokio::time::timeout;

    use super::*;
    use crate::runtime_control::types;

    const SUPERVISOR_CONTROL_AUTHORITY: &str = "http://onequery-supervisor";
    const SHARED_STREAM_BOUND: usize = 8;

    #[tokio::test]
    async fn server_starts_and_serves_get_status_over_unix_socket() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        let server = start_supervisor_control_server(socket_path.clone(), test_service(41))
            .await
            .unwrap();

        let status = get_status(socket_path.as_path()).await;

        assert_eq!(status.supervisor_sequence, Some(41));

        server.stop().await.unwrap();
    }

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

    #[tokio::test]
    async fn get_status_rejects_mismatched_target_identity() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        let server = start_supervisor_control_server(socket_path.clone(), test_service(1))
            .await
            .unwrap();
        let client = supervisor_client(socket_path.as_path()).await;

        let error = client
            .get_status(types::SupervisorLifecycleServiceGetStatusRequest {
                target: MessageField::some(test_target_with_launch_id("stale-launch")),
                ..Default::default()
            })
            .await
            .expect_err("expected target mismatch to be rejected");

        assert_eq!(error.code, ErrorCode::FailedPrecondition);

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn open_runtime_session_rejects_mismatched_hello_without_registering_session() {
        let temp_dir = tempfile::tempdir().expect("expected temp dir");
        let socket_path = temp_dir.path().join("run").join("supervisor-control.sock");
        let server = start_supervisor_control_server(socket_path.clone(), test_service(7))
            .await
            .unwrap();
        let client = supervisor_client(socket_path.as_path()).await;
        let mut session = client.open_runtime_session().await.unwrap();

        session
            .send(types::OpenRuntimeSessionRequest {
                payload: Some(types::open_runtime_session_request::Payload::Hello(Box::new(
                    test_session_hello_with_launch_id("stale-launch"),
                ))),
                ..Default::default()
            })
            .await
            .unwrap();
        session.close_send();

        let message = timeout(Duration::from_secs(1), session.message())
            .await
            .expect("expected rejected session to finish")
            .expect("expected rejected session to close cleanly");
        assert!(message.is_none());

        let error = session
            .error()
            .expect("expected rejected session to expose Connect error");
        assert_eq!(error.code, ErrorCode::FailedPrecondition);

        let status = get_status(socket_path.as_path()).await;
        assert_eq!(status.supervisor_sequence, Some(7));
        assert_eq!(status.active_session, Some(false));

        server.stop().await.unwrap();
    }

    async fn get_status(socket_path: &Path) -> types::SupervisorStatus {
        let client = supervisor_client(socket_path).await;
        let response = client
            .get_status(types::SupervisorLifecycleServiceGetStatusRequest {
                target: MessageField::some(test_target()),
                ..Default::default()
            })
            .await
            .unwrap()
            .into_owned();

        response.status.into_option().unwrap()
    }

    async fn supervisor_client(
        socket_path: &Path,
    ) -> SupervisorLifecycleServiceClient<connectrpc::client::SharedHttp2Connection> {
        let authority: http::Uri = SUPERVISOR_CONTROL_AUTHORITY.parse().unwrap();
        let connection = Http2Connection::connect_unix(socket_path, authority.clone())
            .await
            .unwrap();
        SupervisorLifecycleServiceClient::new(
            connection.shared(SHARED_STREAM_BOUND),
            ClientConfig::new(authority),
        )
    }

    fn test_service(sequence: u64) -> SupervisorControlService {
        SupervisorControlService::new(super::super::actor::SupervisorControlActor::new(
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
                    pid: Some(4242),
                    launch_id: Some("launch-a".to_owned()),
                    data_dir: Some("/tmp/onequery-data".to_owned()),
                    ..Default::default()
                }),
                active_session: Some(false),
                ..Default::default()
            },
        ))
    }

    fn test_target() -> types::SupervisorStopTarget {
        test_target_with_launch_id("launch-a")
    }

    fn test_target_with_launch_id(launch_id: &str) -> types::SupervisorStopTarget {
        types::SupervisorStopTarget {
            launch_id: Some(launch_id.to_owned()),
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

    fn test_session_hello_with_launch_id(launch_id: &str) -> types::RuntimeSessionHello {
        types::RuntimeSessionHello {
            launch_id: Some(launch_id.to_owned()),
            data_dir: Some("/tmp/onequery-data".to_owned()),
            runtime_pid: Some(4242),
            supervisor: MessageField::some(types::SupervisorIdentity {
                supervisor_id: Some("gateway-supervisor:test".to_owned()),
                pid: Some(1),
                generation: Some(1),
                ..Default::default()
            }),
            runtime_sequence: Some(1),
            ..Default::default()
        }
    }
}
