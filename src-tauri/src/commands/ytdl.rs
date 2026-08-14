use std::time::{Duration, Instant};

use serde_json::Value;

use crate::models::YtTrack;

const SEARCH_TIMEOUT: Duration = Duration::from_secs(60);
const URL_TIMEOUT: Duration = Duration::from_secs(30);

/// 定位 yt-dlp 二进制（PATH 优先，常见安装路径兜底）。
fn find_ytdl() -> Result<String, String> {
    for candidate in [
        "yt-dlp",
        "/opt/homebrew/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
    ] {
        if let Ok(path) = std::process::Command::new(candidate)
            .arg("--version")
            .output()
        {
            if path.status.success() {
                return Ok(candidate.to_string());
            }
        }
    }
    Err("未找到 yt-dlp（请先安装：brew install yt-dlp）".to_string())
}

/// 执行 yt-dlp（参数数组直传，无 shell 注入面），带超时兜底。
fn run_ytdl(args: &[&str], timeout: Duration) -> Result<String, String> {
    let binary = find_ytdl()?;
    let mut child = std::process::Command::new(&binary)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("yt-dlp 启动失败: {e}"))?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let last = stderr.lines().last().unwrap_or("未知错误");
                return Err(format!("yt-dlp 失败: {last}"));
            }
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return Err("yt-dlp 超时".to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// 标题启发式：「艺术家 - 曲名」拆分；后半含官方/MV/歌词等标记时不拆。
pub fn split_yt_title(title: &str) -> (String, String) {
    const BAD_MARKERS: &[&str] = &[
        "official",
        "music video",
        " mv",
        "lyrics",
        " live",
        "cover",
        "hq",
        "歌词版",
        "纯享",
        "演唱会",
    ];
    if let Some((left, right)) = title.split_once(" - ") {
        let left = left.trim();
        let right = right.trim();
        let lower = right.to_lowercase();
        if !left.is_empty() && !right.is_empty() && !BAD_MARKERS.iter().any(|m| lower.contains(m)) {
            return (left.to_string(), right.to_string());
        }
    }
    (String::new(), title.trim().to_string())
}

/// 解析 yt-dlp --flat-playlist -J 输出为音轨列表（纯函数，可单测）。
pub fn parse_ytdl_search(json: &str) -> Result<Vec<YtTrack>, String> {
    let root: Value =
        serde_json::from_str(json).map_err(|e| format!("yt-dlp 输出解析失败: {e}"))?;
    let entries = root
        .get("entries")
        .and_then(|e| e.as_array())
        .ok_or_else(|| "yt-dlp 输出无搜索结果".to_string())?;
    let mut tracks = Vec::new();
    for entry in entries {
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let title = entry
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("未知曲目");
        let duration = entry
            .get("duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let (artist, name) = split_yt_title(title);
        tracks.push(YtTrack {
            video_id: id.to_string(),
            title: name,
            artist,
            duration: duration.round() as u64,
            thumbnail: format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"),
        });
    }
    Ok(tracks)
}

/// YouTube 搜索（yt-dlp sidecar，无账号零风控风险）。
#[tauri::command]
pub async fn ytdl_search(query: String, limit: Option<u32>) -> Result<Vec<YtTrack>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 30);
    tauri::async_runtime::spawn_blocking(move || {
        let spec = format!("ytsearch{limit}:{query}");
        let output = run_ytdl(
            &["--flat-playlist", "-J", "--no-warnings", &spec],
            SEARCH_TIMEOUT,
        )?;
        parse_ytdl_search(&output)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 取流地址（强制 m4a/AAC——WKWebView 不支持 Opus/WebM）。
#[tauri::command]
pub async fn ytdl_url(video_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let watch = format!("https://www.youtube.com/watch?v={video_id}");
        let output = run_ytdl(
            &[
                "-f",
                "bestaudio[ext=m4a]/bestaudio",
                "-g",
                "--no-warnings",
                &watch,
            ],
            URL_TIMEOUT,
        )?;
        output
            .lines()
            .next()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "yt-dlp 未返回流地址".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_title_basic_and_markers() {
        assert_eq!(
            split_yt_title("周杰伦 - 晴天"),
            ("周杰伦".to_string(), "晴天".to_string())
        );
        let (artist, name) =
            split_yt_title("周杰倫 Jay Chou【晴天 Sunny Day】-Official Music Video");
        assert_eq!(artist, "");
        assert!(name.contains("晴天"));
        assert_eq!(
            split_yt_title("纯音乐无分隔"),
            (String::new(), "纯音乐无分隔".to_string())
        );
    }

    #[test]
    fn parse_search_maps_entries() {
        let json = r#"{"entries":[
            {"id":"abc123","title":"周杰伦 - 晴天","duration":319},
            {"id":"def456","title":"Some Song - Official MV","duration":270}
        ]}"#;
        let tracks = parse_ytdl_search(json).expect("parse");
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].artist, "周杰伦");
        assert_eq!(tracks[0].title, "晴天");
        assert_eq!(tracks[0].duration, 319);
        assert_eq!(
            tracks[0].thumbnail,
            "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
        );
        assert_eq!(tracks[1].artist, "");
    }

    #[test]
    fn parse_search_tolerates_bad_json() {
        assert!(parse_ytdl_search("not json").is_err());
        assert!(parse_ytdl_search(r#"{"entries":[]}"#)
            .expect("empty")
            .is_empty());
    }
}
