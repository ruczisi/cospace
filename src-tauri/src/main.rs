// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

// Config module
mod commands;
use commands::config::{
    resolve_path_command,
    load_config_command,
    save_config_command,
    ensure_directory_command,
    write_text_file_command,
    append_text_file_command,
    read_text_file_command,
    get_global_config,
    save_global_config,
    init_global_config,
    detect_llm_config,
};
use commands::workflow::{
    parse_workflow_file,
    parse_workflow_content,
    validate_workflow_command,
    render_template_command,
    get_execution_order,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEvent {
    pub path: String,
    pub event_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamTask {
    pub id: String,
    pub name: String,
    pub status: String,
    pub progress: f32,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentType {
    Claude,
    Codex,
    OpenCode,
    Custom,
}

impl AgentType {
    pub fn executable_name(&self) -> &str {
        match self {
            AgentType::Claude => "claude",
            AgentType::Codex => "codex",
            AgentType::OpenCode => "opencode",
            AgentType::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent_type: AgentType,
    pub command: Option<String>,
    pub working_dir: Option<String>,
    pub env_vars: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionOutput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionExit {
    pub session_id: String,
    pub code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeConversation {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub message_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutputEvent {
    pub task_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentThinkingEvent {
    pub task_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExitEvent {
    pub task_id: String,
    pub code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: String,
}

pub struct AppState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub watched_path: Mutex<Option<String>>,
    pub bridge_port: Mutex<Option<u16>>,
    pub bridge_process: Mutex<Option<tokio::process::Child>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            watched_path: Mutex::new(None),
            bridge_port: Mutex::new(None),
            bridge_process: Mutex::new(None),
        }
    }
}

/// Format a bridge status event into a concise human-readable string.
/// Returns None for events that should be silently dropped (keep_alive, etc.).
fn format_status_event(data: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(data).ok()?;

    // Task notification
    if let Some(status) = json.get("notification").and_then(|v| v.as_bool()) {
        if status {
            let title = json.get("title").and_then(|v| v.as_str()).unwrap_or("通知");
            let message = json.get("message").and_then(|v| v.as_str()).unwrap_or("");
            if message.is_empty() {
                return Some(format!("📋 {}", title));
            }
            return Some(format!("📋 {} · {}", title, message));
        }
    }

    // Init status (session_id, model, tools) — shown in bottom status bar, don't show in chat
    if json.get("session_id").and_then(|v| v.as_str()).is_some() {
        return None;
    }

    // Permission mode change — internal detail, don't show in chat
    if json.get("permissionMode").and_then(|v| v.as_str()).is_some() {
        return None;
    }

    // keep_alive and other noise — silently drop
    None
}

#[tauri::command]
async fn start_file_watcher(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let app_clone = app.clone();

    let (tx, rx): (_, Receiver<Result<notify::Event, notify::Error>>) = channel();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default().with_poll_interval(Duration::from_secs(1)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&path_buf, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut watcher_guard = state.watcher.lock().await;
    *watcher_guard = Some(watcher);

    let mut path_guard = state.watched_path.lock().await;
    *path_guard = Some(path.clone());

    tokio::spawn(async move {
        while let Ok(res) = rx.recv() {
            match res {
                Ok(event) => {
                    for event_path in event.paths {
                        let event_type = match event.kind {
                            notify::EventKind::Create(_) => "create",
                            notify::EventKind::Modify(_) => "modify",
                            notify::EventKind::Remove(_) => "remove",
                            _ => continue,
                        };

                        let file_event = FileEvent {
                            path: event_path.to_string_lossy().to_string(),
                            event_type: event_type.to_string(),
                        };

                        let _ = app_clone.emit("file-change", file_event);
                    }
                }
                Err(e) => {
                    log::error!("File watcher error: {:?}", e);
                }
            }
        }
    });

    Ok(format!("Started watching: {}", path))
}

#[tauri::command]
async fn stop_file_watcher(state: State<'_, AppState>) -> Result<String, String> {
    let mut watcher_guard = state.watcher.lock().await;
    *watcher_guard = None;

    let mut path_guard = state.watched_path.lock().await;
    *path_guard = None;

    Ok("File watcher stopped".to_string())
}

#[tauri::command]
fn get_watched_path(state: State<'_, AppState>) -> Option<String> {
    state.watched_path.blocking_lock().clone()
}

#[tauri::command]
fn update_team_tasks(app: AppHandle, tasks: Vec<TeamTask>) -> Result<(), String> {
    app.emit("team-tasks-update", tasks)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn find_agent_in_path(agent_type: AgentType) -> Result<Option<String>, String> {
    let executable_name = agent_type.executable_name();
    log::info!("[Cospace] find_agent_in_path searching for: {}", executable_name);

    #[cfg(target_os = "windows")]
    {
        let common_paths = vec![
            std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default())
                .join("claude"),
            std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default())
                .join(".local")
                .join("bin"),
            std::path::PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
                .join("npm"),
        ];

        for base in &common_paths {
            for ext in &["", ".exe", ".cmd", ".bat"] {
                let candidate = base.join(format!("{}{}", executable_name, ext));
                let path_str = candidate.to_string_lossy();
                log::info!("[Cospace] checking: {}", path_str);
                if candidate.exists() {
                    log::info!("[Cospace] FOUND: {}", path_str);
                    return Ok(Some(path_str.to_string()));
                }
            }
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for ext in &["", ".exe", ".cmd", ".bat"] {
                let candidate = dir.join(format!("{}{}", executable_name, ext));
                let path_str = candidate.to_string_lossy();
                if candidate.exists() {
                    log::info!("[Cospace] FOUND in PATH: {}", path_str);
                    return Ok(Some(path_str.to_string()));
                }
            }
        }
    }

    log::warn!("[Cospace] agent not found: {}", executable_name);
    Ok(None)
}

/// Get the resource path where bundled assets are stored
#[tauri::command]
fn get_resource_path(app: AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;
    Ok(resource_dir.to_string_lossy().to_string())
}

/// Get the current working directory
#[tauri::command]
fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ===== Agent Bridge Integration =====

/// Start the Node.js agent bridge and return its port.
#[tauri::command]
async fn start_agent_bridge(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<u16, String> {
    // Check if bridge is already running
    {
        let port_guard = state.bridge_port.lock().await;
        if let Some(port) = *port_guard {
            // Health check
            let client = reqwest::Client::builder().no_proxy().build().unwrap_or_else(|_| reqwest::Client::new());
            match client
                .get(format!("http://127.0.0.1:{}/health", port))
                .timeout(Duration::from_secs(2))
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => return Ok(port),
                _ => {}
            }
        }
    }

    // Kill any existing bridge process
    {
        let mut proc_guard = state.bridge_process.lock().await;
        if let Some(mut child) = proc_guard.take() {
            let _ = child.start_kill();
        }
    }

    // Find node executable
    let node_exe = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    // Verify Node.js is available
    let node_check = tokio::process::Command::new(node_exe)
        .arg("--version")
        .output()
        .await;
    if node_check.is_err() || !node_check.as_ref().unwrap().status.success() {
        return Err(
            "Node.js 未安装或不在 PATH 中。Agent Bridge 需要 Node.js 20+ 才能运行。\n\
             请从 https://nodejs.org/ 安装 Node.js。".to_string()
        );
    }

    // Determine bridge script path
    // In dev: use src-tauri/agent-bridge/dist/index.js (relative to project root)
    // In prod: use bundled resource path
    let bridge_script = if cfg!(debug_assertions) {
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        // In dev, cwd is the src-tauri directory (where Cargo.toml lives)
        cwd.join("agent-bridge").join("dist").join("index.js")
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?;
        resource_dir.join("agent-bridge").join("dist").join("bundle.js")
    };

    if !bridge_script.exists() {
        return Err(format!(
            "Agent bridge not found at {}. Please build it first: cd src-tauri/agent-bridge && npm install && npm run build",
            bridge_script.display()
        ));
    }

    log::info!("[Cospace] Starting agent bridge: {} {}", node_exe, bridge_script.display());

    let mut cmd = tokio::process::Command::new(node_exe);
    cmd.arg(&bridge_script)
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!("Failed to spawn agent bridge: {}. Is Node.js installed?", e)
    })?;

    let stdout = child.stdout.take().ok_or("Failed to capture bridge stdout")?;
    let stderr = child.stderr.take();

    // Spawn stdout reader that finds the port and keeps draining to prevent EPIPE
    let (port_tx, port_rx) = tokio::sync::oneshot::channel::<u16>();

    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut port_tx = Some(port_tx);

        while let Ok(Some(line)) = lines.next_line().await {
            log::info!("[Bridge stdout] {}", line);
            if let Some(port_str) = line.trim().strip_prefix("[bridge] Ready on port ") {
                if let Ok(p) = port_str.parse::<u16>() {
                    if let Some(tx) = port_tx.take() {
                        let _ = tx.send(p);
                    }
                }
            }
        }
    });

    // Wait for port with timeout
    let timeout = tokio::time::Duration::from_secs(10);
    let port = match tokio::time::timeout(timeout, port_rx).await {
        Ok(Ok(p)) => p,
        Ok(Err(_)) => {
            let _ = child.start_kill();
            return Err("Agent bridge port channel closed unexpectedly".to_string());
        }
        Err(_) => {
            let _ = child.start_kill();
            return Err("Agent bridge failed to start within 10 seconds".to_string());
        }
    };

    // Store the process and port
    {
        let mut proc_guard = state.bridge_process.lock().await;
        *proc_guard = Some(child);
    }
    {
        let mut port_guard = state.bridge_port.lock().await;
        *port_guard = Some(port);
    }

    // Spawn stderr reader
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    log::info!("[Bridge stderr] {}", line);
                }
            }
        });
    }

    log::info!("[Cospace] Agent bridge ready on port {}", port);
    Ok(port)
}

/// Stop the agent bridge.
#[tauri::command]
async fn stop_agent_bridge(state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut port_guard = state.bridge_port.lock().await;
        *port_guard = None;
    }
    {
        let mut proc_guard = state.bridge_process.lock().await;
        if let Some(mut child) = proc_guard.take() {
            let _ = child.start_kill();
        }
    }
    Ok(())
}

/// Forward SSE events from the bridge to the frontend via Tauri events.
async fn forward_bridge_events(
    app: AppHandle,
    task_id: String,
    stream: reqwest::Response,
) {
    use futures_util::StreamExt;

    let mut byte_stream = stream.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = byte_stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                // Process complete SSE lines
                while let Some(line_end) = buffer.find("\n\n") {
                    let frame = buffer[..line_end].to_string();
                    buffer = buffer[line_end + 2..].to_string();

                    // Parse "data: {...}"
                    if let Some(data_line) = frame.lines().find(|l| l.starts_with("data:")) {
                        let json_str = data_line[5..].trim();
                        match serde_json::from_str::<BridgeEvent>(json_str) {
                            Ok(event) => {
                                match event.event_type.as_str() {
                                    "text" | "tool_output" => {
                                        let _ = app.emit(
                                            "agent-output",
                                            AgentOutputEvent {
                                                task_id: task_id.clone(),
                                                data: event.data,
                                            },
                                        );
                                    }
                                    "thinking" => {
                                        let _ = app.emit(
                                            "agent-thinking",
                                            AgentThinkingEvent {
                                                task_id: task_id.clone(),
                                                data: event.data,
                                            },
                                        );
                                    }
                                    "tool_use" | "tool_result" | "mode_changed" => {
                                        // Technical events — log only, don't show in chat
                                        log::debug!("[Cospace] Bridge {}: {}", event.event_type, event.data);
                                    }
                                    "status" => {
                                        let display = format_status_event(&event.data);
                                        if let Some(text) = display {
                                            let _ = app.emit(
                                                "agent-output",
                                                AgentOutputEvent {
                                                    task_id: task_id.clone(),
                                                    data: text,
                                                },
                                            );
                                        }
                                        // keep_alive and other noise is silently dropped
                                    }
                                    "result" | "done" => {
                                        // Session lifecycle events — don't emit to chat UI
                                        log::info!("[Cospace] Bridge session {}: {}", event.event_type, event.data);
                                        let _ = app.emit(
                                            "agent-exit",
                                            AgentExitEvent {
                                                task_id: task_id.clone(),
                                                code: 0,
                                            },
                                        );
                                        if event.event_type == "done" {
                                            return;
                                        }
                                    }
                                    "error" => {
                                        let _ = app.emit(
                                            "agent-output",
                                            AgentOutputEvent {
                                                task_id: task_id.clone(),
                                                data: format!("[Error] {}", event.data),
                                            },
                                        );
                                        let _ = app.emit(
                                            "agent-exit",
                                            AgentExitEvent {
                                                task_id: task_id.clone(),
                                                code: 1,
                                            },
                                        );
                                        return;
                                    }
                                    _ => {}
                                }
                            }
                            Err(e) => {
                                log::warn!("[Cospace] Failed to parse bridge event: {} | raw: {}", e, json_str);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("[Cospace] SSE stream error for {}: {}", task_id, e);
                let _ = app.emit(
                    "agent-exit",
                    AgentExitEvent {
                        task_id: task_id.clone(),
                        code: 1,
                    },
                );
                return;
            }
        }
    }

    // Stream ended normally
    let _ = app.emit(
        "agent-exit",
        AgentExitEvent {
            task_id: task_id.clone(),
            code: 0,
        },
    );
}

#[tauri::command]
async fn agent_start(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    working_dir: String,
    prompt: String,
    agent_type: String,
    custom_command: Option<String>,
) -> Result<String, String> {
    // Ensure bridge is running
    let port = start_agent_bridge(app.clone(), state.clone()).await?;

    let client = reqwest::Client::builder().no_proxy().build().unwrap_or_else(|_| reqwest::Client::new());

    // Build request body
    let body = serde_json::json!({
        "taskId": task_id,
        "workingDir": working_dir,
        "prompt": prompt,
        "agentType": agent_type,
        "customCommand": custom_command,
    });

    // Send POST to /sessions with SSE response
    let response = client
        .post(format!("http://127.0.0.1:{}/sessions", port))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to start agent session: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let err_text = response.text().await.unwrap_or_default();
        log::error!("[Cospace] Agent session start failed with HTTP {}: {}", status, err_text);
        return Err(format!("Agent session start failed (HTTP {}): {}", status, err_text));
    }

    // Spawn SSE forwarder
    let app_clone = app.clone();
    let tid = task_id.clone();
    tokio::spawn(async move {
        forward_bridge_events(app_clone, tid, response).await;
    });

    Ok(task_id)
}

#[tauri::command]
async fn agent_send(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    prompt: String,
) -> Result<String, String> {
    let port = {
        let port_guard = state.bridge_port.lock().await;
        port_guard.ok_or("Agent bridge not running. Please start a session first.")?
    };

    let client = reqwest::Client::builder().no_proxy().build().unwrap_or_else(|_| reqwest::Client::new());

    let body = serde_json::json!({
        "prompt": prompt,
    });

    let response = client
        .post(format!("http://127.0.0.1:{}/sessions/{}/message", port, task_id))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to send message: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("Send message failed: {}", err_text));
    }

    let app_clone = app.clone();
    let tid = task_id.clone();
    tokio::spawn(async move {
        forward_bridge_events(app_clone, tid, response).await;
    });

    Ok(task_id)
}

#[tauri::command]
async fn agent_stop(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let port = {
        let port_guard = state.bridge_port.lock().await;
        port_guard.ok_or("Agent bridge not running")?
    };

    let client = reqwest::Client::builder().no_proxy().build().unwrap_or_else(|_| reqwest::Client::new());
    let _ = client
        .delete(format!("http://127.0.0.1:{}/sessions/{}", port, task_id))
        .send()
        .await;

    Ok(())
}

/// Quick line count for a file by counting newline bytes.
fn quick_line_count(path: &std::path::Path) -> u32 {
    use std::io::Read;
    if let Ok(mut f) = std::fs::File::open(path) {
        let mut buf = [0u8; 65536];
        let mut count = 0u32;
        loop {
            match f.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    count += buf[..n].iter().filter(|&&b| b == b'\n').count() as u32;
                }
                Err(_) => break,
            }
        }
        return count;
    }
    0
}

/// Format a SystemTime to ISO string for display.
fn fmt_time(t: std::time::SystemTime) -> String {
    let secs = t
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as YYYY-MM-DD HH:MM
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let h = time_secs / 3600;
    let m = (time_secs % 3600) / 60;

    // Simple date from days since epoch
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let month_days = if (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut mo = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md as i64 {
            mo = i;
            break;
        }
        remaining -= md as i64;
    }
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:00Z",
        y,
        mo + 1,
        remaining + 1,
        h,
        m
    )
}

/// Scan a directory recursively for .jsonl files and return conversation metadata.
fn scan_jsonl_files(dir: &std::path::Path, conversations: &mut Vec<ClaudeConversation>) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories (one level)
                if let Ok(sub_entries) = std::fs::read_dir(&path) {
                    for sub in sub_entries.flatten() {
                        let sub_path = sub.path();
                        if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                            process_jsonl_file(&sub_path, conversations);
                        }
                    }
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                process_jsonl_file(&path, conversations);
            }
        }
    }
}

fn process_jsonl_file(path: &std::path::Path, conversations: &mut Vec<ClaudeConversation>) {
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return;
    }

    // Skip if already added (dedup)
    if conversations.iter().any(|c| c.id == id) {
        return;
    }

    let updated_at = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map(fmt_time)
        .unwrap_or_default();

    let message_count = quick_line_count(path);

    // Date-based name — user can rename in-app by double-clicking
    let name = if updated_at.len() >= 16 {
        format!("{} 对话", &updated_at[..16])
    } else {
        format!("对话 {}", &id[..8])
    };

    conversations.push(ClaudeConversation {
        id,
        name,
        updated_at,
        message_count,
    })
}

#[tauri::command]
async fn scan_conversations(
    workspace_path: Option<String>,
    additional_paths: Vec<String>,
) -> Result<Vec<ClaudeConversation>, String> {
    let mut all_ids = std::collections::HashSet::new();
    let mut conversations = Vec::new();

    // 1. Always scan ~/.claude/projects/ for Claude Code sessions
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let claude_projects = std::path::PathBuf::from(&home).join(".claude").join("projects");
        if claude_projects.exists() {
            if let Ok(entries) = std::fs::read_dir(&claude_projects) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        scan_jsonl_files(&path, &mut conversations);
                    } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        process_jsonl_file(&path, &mut conversations);
                    }
                }
            }
        }
        // Also scan ~/.claude/ directly (some tools store sessions at top level)
        let claude_dir = std::path::PathBuf::from(&home).join(".claude");
        scan_jsonl_files(&claude_dir, &mut conversations);
    }

    // 2. Scan workspace path
    if let Some(wp) = &workspace_path {
        let wp_path = std::path::PathBuf::from(wp);
        if wp_path.exists() {
            // Scan workspace/.claude/
            scan_jsonl_files(&wp_path.join(".claude"), &mut conversations);
            // Scan workspace root for session files
            scan_jsonl_files(&wp_path, &mut conversations);
        }
    }

    // 3. Scan user-provided additional paths
    for p in &additional_paths {
        let ap = std::path::PathBuf::from(p);
        if ap.exists() {
            scan_jsonl_files(&ap, &mut conversations);
        }
    }

    // Deduplicate by id
    conversations.retain(|c| {
        if all_ids.contains(&c.id) {
            false
        } else {
            all_ids.insert(c.id.clone());
            true
        }
    });

    // Sort by updated_at descending
    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    conversations.truncate(10);

    Ok(conversations)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_file_watcher,
            stop_file_watcher,
            get_watched_path,
            update_team_tasks,
            find_agent_in_path,
            get_resource_path,
            get_cwd,
            start_agent_bridge,
            stop_agent_bridge,
            agent_start,
            agent_send,
            agent_stop,
            scan_conversations,
            // Config commands
            resolve_path_command,
            load_config_command,
            save_config_command,
            ensure_directory_command,
            write_text_file_command,
            append_text_file_command,
            read_text_file_command,
            get_global_config,
            save_global_config,
            init_global_config,
            detect_llm_config,
            // Workflow commands
            parse_workflow_file,
            parse_workflow_content,
            validate_workflow_command,
            render_template_command,
            get_execution_order,
        ])
        .setup(|_app| {
            log::info!("Cospace started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
