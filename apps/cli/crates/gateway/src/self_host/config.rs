use serde::Deserialize;
use serde::Serialize;

pub(super) const SELF_HOST_CONFIG_DIR_NAME: &str = "self-host";
pub const DEFAULT_SELF_HOST_LISTEN_HOST: &str = "127.0.0.1";
pub const DEFAULT_SELF_HOST_PORT: u16 = 5656;

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct SelfHostConfig {
    #[serde(default)]
    pub server: ServerSection,
    #[serde(default, skip_serializing_if = "SmtpConfig::is_empty")]
    pub smtp: SmtpConfig,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServerSection {
    #[serde(default = "default_listen_host")]
    pub listen_host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub public_origin: Option<String>,
}

impl Default for ServerSection {
    fn default() -> Self {
        Self {
            listen_host: default_listen_host(),
            port: default_port(),
            public_origin: None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct SmtpConfig {
    #[serde(default)]
    pub from_email: Option<String>,
    #[serde(default)]
    pub from_name: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub secure: Option<bool>,
    #[serde(default)]
    pub username: Option<String>,
}

impl SmtpConfig {
    fn is_empty(&self) -> bool {
        self.from_email.is_none()
            && self.from_name.is_none()
            && self.host.is_none()
            && self.port.is_none()
            && self.secure.is_none()
            && self.username.is_none()
    }
}

fn default_listen_host() -> String {
    DEFAULT_SELF_HOST_LISTEN_HOST.to_owned()
}

pub fn default_port() -> u16 {
    DEFAULT_SELF_HOST_PORT
}

pub fn default_public_origin() -> String {
    resolve_default_public_origin(DEFAULT_SELF_HOST_LISTEN_HOST, DEFAULT_SELF_HOST_PORT)
}

pub fn self_host_public_origin(config: &SelfHostConfig) -> String {
    config.server.public_origin.as_ref().map_or_else(
        || resolve_default_public_origin(&config.server.listen_host, config.server.port),
        ToOwned::to_owned,
    )
}

pub(super) fn resolve_default_public_origin(listen_host: &str, port: u16) -> String {
    let public_host = resolve_default_public_host(listen_host);
    format!("http://{public_host}:{port}")
}

fn resolve_default_public_host(listen_host: &str) -> &str {
    if listen_host == "0.0.0.0" {
        return DEFAULT_SELF_HOST_LISTEN_HOST;
    }

    listen_host
}
