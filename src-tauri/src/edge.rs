use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use socket2::{Domain, Socket, Type};
use tauri::{AppHandle, Emitter, Listener, Manager};

/// Keep in sync with edge-widget/manifest.json and scripts/widget.js.
pub const PORT: u16 = 47321;
const CLIENT_HEADER: &str = "x-aion-edge";
const MAX_BODY: usize = 4096;
const MAX_SNAPSHOT: usize = 262_144;

pub fn start(app: &tauri::App) {
    let snapshot = Arc::new(Mutex::new(WAITING.to_string()));
    let stored = Arc::clone(&snapshot);
    let handle = app.handle().clone();
    let listener = handle.listen("edge-snapshot", move |event| {
        let Some(next) = normalize_snapshot(event.payload()) else { return };
        let mut slot = stored.lock().unwrap_or_else(|poison| poison.into_inner());
        *slot = next;
    });
    app.manage(EdgeKeep { _listener: listener });

    let bridge = handle.clone();
    let _ = thread::Builder::new().name("edge-bridge".into()).spawn(move || serve(bridge, snapshot));
}

struct EdgeKeep {
    _listener: tauri::EventId,
}

const WAITING: &str = r#"{"ok":false,"reason":"waiting"}"#;

fn serve(app: AppHandle, snapshot: Arc<Mutex<String>>) {
    let Some(listener) = bind() else { return };
    for incoming in listener.incoming() {
        let Ok(mut stream) = incoming else { continue };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
        let _ = handle_client(&mut stream, &app, &snapshot);
    }
}

fn bind() -> Option<TcpListener> {
    let addr: SocketAddr = format!("127.0.0.1:{PORT}").parse().ok()?;
    let socket = Socket::new(Domain::IPV4, Type::STREAM, None).ok()?;
    socket.set_reuse_address(true).ok()?;
    socket.bind(&addr.into()).ok()?;
    socket.listen(16).ok()?;
    Some(TcpListener::from(socket))
}

fn handle_client(stream: &mut TcpStream, app: &AppHandle, snapshot: &Mutex<String>) -> std::io::Result<()> {
    let Some(request) = read_request(stream) else {
        return write_response(stream, 400, None, r#"{"ok":false,"reason":"bad request"}"#);
    };
    let current = snapshot.lock().unwrap_or_else(|poison| poison.into_inner()).clone();
    let reply = respond(&request, &current);
    if let Some(action) = reply.action {
        let _ = match action {
            Action::Kill(id) => app.emit("timer-killed", serde_json::json!({ "id": id })),
            Action::Seen(id) => app.emit("timer-seen", serde_json::json!({ "id": id })),
            Action::List => app.emit("overlay-compact", ()),
            Action::Bosses => app.emit("edge-refresh-bosses", ()),
        };
    }
    write_response(stream, reply.status, request.origin.as_deref(), &reply.body)
}

struct Request {
    method: String,
    path: String,
    origin: Option<String>,
    client: bool,
    body: String,
}

struct Reply {
    status: u16,
    body: String,
    action: Option<Action>,
}

#[derive(Debug)]
enum Action {
    Kill(String),
    Seen(String),
    List,
    Bosses,
}

fn respond(request: &Request, snapshot: &str) -> Reply {
    if request.method == "OPTIONS" {
        return Reply { status: 204, body: String::new(), action: None };
    }
    if !origin_allowed(request.origin.as_deref()) || !request.client {
        return Reply { status: 403, body: r#"{"ok":false,"reason":"forbidden"}"#.into(), action: None };
    }
    let path = request.path.trim_end_matches('/');
    if request.method == "GET" && path == "/v1/overlay" {
        return Reply { status: 200, body: snapshot.to_string(), action: None };
    }
    if request.method == "POST" && path == "/v1/action" {
        return match action_from(&request.body) {
            Some(action) => Reply { status: 200, body: r#"{"ok":true}"#.into(), action: Some(action) },
            None => Reply { status: 400, body: r#"{"ok":false,"reason":"bad action"}"#.into(), action: None },
        };
    }
    if request.method == "GET" || request.method == "POST" {
        return Reply { status: 404, body: r#"{"ok":false,"reason":"not found"}"#.into(), action: None };
    }
    Reply { status: 405, body: r#"{"ok":false,"reason":"method"}"#.into(), action: None }
}

fn action_from(body: &str) -> Option<Action> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    match value.get("type").and_then(|item| item.as_str())? {
        "list" => Some(Action::List),
        "bosses" => Some(Action::Bosses),
        "kill" => Some(Action::Kill(valid_id(value.get("id")?)?)),
        "seen" => Some(Action::Seen(valid_id(value.get("id")?)?)),
        _ => None,
    }
}

fn valid_id(value: &serde_json::Value) -> Option<String> {
    let id = value.as_str()?;
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        return None;
    }
    Some(id.to_string())
}

fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return true };
    if origin == "null" { return true }
    let lower = origin.to_ascii_lowercase();
    if lower.starts_with("http://127.0.0.1")
        || lower.starts_with("http://localhost")
        || lower.starts_with("https://127.0.0.1")
        || lower.starts_with("https://localhost")
    {
        return true;
    }
    !(lower.starts_with("http://") || lower.starts_with("https://"))
}

fn normalize_snapshot(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let text = if trimmed.starts_with('"') {
        serde_json::from_str::<String>(trimmed).ok()?
    } else {
        trimmed.to_string()
    };
    if text.len() > MAX_SNAPSHOT { return None }
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    if value.get("ok") != Some(&serde_json::Value::Bool(true)) { return None }
    if !value.get("rows").is_some_and(|rows| rows.is_array()) { return None }
    Some(text)
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut tmp).ok()?;
        if read == 0 { return None }
        buf.extend_from_slice(&tmp[..read]);
        if buf.len() > 20_480 { return None }
        if let Some(pos) = find_headers(&buf) { break pos }
    };
    let header = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let declared = content_length(&header)?;
    if declared > MAX_BODY { return None }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < declared {
        let read = stream.read(&mut tmp).ok()?;
        if read == 0 { return None }
        body.extend_from_slice(&tmp[..read]);
        if body.len() > MAX_BODY { return None }
    }
    body.truncate(declared);
    let mut lines = header.lines();
    let request = lines.next()?.trim();
    let mut parts = request.split_whitespace();
    let method = parts.next()?.to_ascii_uppercase();
    let target = parts.next()?;
    let path = target.split('?').next()?.to_string();
    Some(Request {
        method,
        path,
        origin: header_value(&header, "origin"),
        client: header_value(&header, CLIENT_HEADER).as_deref() == Some("1"),
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

fn content_length(header: &str) -> Option<usize> {
    header_value(header, "content-length").and_then(|value| value.parse().ok()).or(Some(0))
}

fn header_value(header: &str, name: &str) -> Option<String> {
    for line in header.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        if key.trim().eq_ignore_ascii_case(name) {
            return Some(value.trim().to_string());
        }
    }
    None
}

fn find_headers(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_response(stream: &mut TcpStream, status: u16, origin: Option<&str>, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let allow_origin = match origin {
        Some(value) if origin_allowed(Some(value)) => value,
        None => "*",
        Some(_) => "",
    };
    let cors = if allow_origin.is_empty() {
        String::new()
    } else {
        format!(
            "Access-Control-Allow-Origin: {allow_origin}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Aion-Edge\r\nAccess-Control-Allow-Private-Network: true\r\nVary: Origin\r\n"
        )
    };
    let bytes = body.as_bytes();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n{cors}\r\n",
        bytes.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(bytes)?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, path: &str, origin: Option<&str>, client: bool, body: &str) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            origin: origin.map(str::to_string),
            client,
            body: body.into(),
        }
    }

    #[test]
    fn overlay_get_returns_the_snapshot() {
        let request = request("GET", "/v1/overlay", Some("null"), true, "");
        let reply = respond(&request, r#"{"ok":true,"rows":[]}"#);
        assert_eq!(reply.status, 200);
        assert!(reply.body.contains("rows"));
        assert!(reply.action.is_none());
    }

    #[test]
    fn web_origin_cannot_read_or_act() {
        let get = request("GET", "/v1/overlay", Some("https://evil.example"), true, "");
        assert_eq!(respond(&get, "{}").status, 403);
        let post = request("POST", "/v1/action", Some("https://evil.example"), true, r#"{"type":"list"}"#);
        let reply = respond(&post, "{}");
        assert_eq!(reply.status, 403);
        assert!(reply.action.is_none());
    }

    #[test]
    fn missing_client_header_is_forbidden() {
        let request = request("GET", "/v1/overlay", None, false, "");
        assert_eq!(respond(&request, "{}").status, 403);
    }

    #[test]
    fn kill_seen_and_list_are_the_only_actions() {
        let kill = request("POST", "/v1/action", None, true, r#"{"type":"kill","id":"nm-2305-2"}"#);
        match respond(&kill, "{}").action {
            Some(Action::Kill(id)) => assert_eq!(id, "nm-2305-2"),
            other => panic!("expected kill, got {other:?}"),
        }
        let seen = request("POST", "/v1/action", None, true, r#"{"type":"seen","id":"field-9f0e"}"#);
        assert!(matches!(respond(&seen, "{}").action, Some(Action::Seen(_))));
        let list = request("POST", "/v1/action", None, true, r#"{"type":"list"}"#);
        assert!(matches!(respond(&list, "{}").action, Some(Action::List)));
        let bosses = request("POST", "/v1/action", None, true, r#"{"type":"bosses"}"#);
        assert!(matches!(respond(&bosses, "{}").action, Some(Action::Bosses)));
        let bad = request("POST", "/v1/action", None, true, r#"{"type":"kill","id":"../state"}"#);
        assert_eq!(respond(&bad, "{}").status, 400);
    }

    #[test]
    fn snapshot_must_be_an_overlay_object() {
        assert!(normalize_snapshot(r#"{"ok":true,"rows":[]}"#).is_some());
        assert!(normalize_snapshot(r#""{\"ok\":true,\"rows\":[]}""#).is_some());
        assert!(normalize_snapshot(r#"{"ok":false}"#).is_none());
        assert!(normalize_snapshot("not json").is_none());
    }

    #[test]
    fn framed_request_keeps_method_header_and_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            read_request(&mut stream).unwrap()
        });
        let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let body = r#"{"type":"kill","id":"nm-1"}"#;
        let head = format!(
            "POST /v1/action?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Aion-Edge: 1\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        client.write_all(head.as_bytes()).unwrap();
        let request = server.join().unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/v1/action");
        assert!(request.client);
        assert_eq!(request.body, body);
        assert!(matches!(respond(&request, "{}").action, Some(Action::Kill(id)) if id == "nm-1"));
    }
}
