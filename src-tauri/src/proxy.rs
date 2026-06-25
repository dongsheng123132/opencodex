//! Proxy env injection for child tools such as Claude Code.
//!
//! GUI apps launched from the desktop often miss shell-only proxy variables. When
//! no proxy env is present, prefer common local HTTP/Mixed ports used by Clash /
//! Mihomo style clients so terminal-launched tools still reach remote APIs.

use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const DEFAULT_NO_PROXY: &str = "localhost,127.0.0.1,::1";
const LOCAL_HTTP_PROXY_PORTS: &[u16] = &[7897, 7890, 7899, 10809];

fn env_value(keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|k| std::env::var(k).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
}

fn detect_local_http_proxy() -> Option<String> {
    for port in LOCAL_HTTP_PROXY_PORTS {
        let addr = SocketAddr::from(([127, 0, 0, 1], *port));
        if TcpStream::connect_timeout(&addr, Duration::from_millis(80)).is_ok() {
            return Some(format!("http://127.0.0.1:{port}"));
        }
    }
    None
}

fn proxy_env_pairs() -> Vec<(&'static str, String)> {
    let http = env_value(&["HTTP_PROXY", "http_proxy"]);
    let https = env_value(&["HTTPS_PROXY", "https_proxy"]);
    let all = env_value(&["ALL_PROXY", "all_proxy"]);
    let detected = https
        .clone()
        .or_else(|| http.clone())
        .or_else(|| all.clone())
        .or_else(detect_local_http_proxy);

    let Some(proxy) = detected else {
        return Vec::new();
    };

    let http = http.unwrap_or_else(|| proxy.clone());
    let https = https.unwrap_or_else(|| proxy.clone());
    let all = all.unwrap_or_else(|| proxy.clone());
    let no_proxy = env_value(&["NO_PROXY", "no_proxy"]).unwrap_or_else(|| DEFAULT_NO_PROXY.to_string());

    vec![
        ("HTTP_PROXY", http.clone()),
        ("HTTPS_PROXY", https.clone()),
        ("ALL_PROXY", all.clone()),
        ("http_proxy", http),
        ("https_proxy", https),
        ("all_proxy", all),
        ("NO_PROXY", no_proxy.clone()),
        ("no_proxy", no_proxy),
    ]
}

pub fn apply_to_command(cmd: &mut std::process::Command) {
    for (key, value) in proxy_env_pairs() {
        cmd.env(key, value);
    }
}

pub fn apply_to_pty(builder: &mut portable_pty::CommandBuilder) {
    for (key, value) in proxy_env_pairs() {
        builder.env(key, value);
    }
}
