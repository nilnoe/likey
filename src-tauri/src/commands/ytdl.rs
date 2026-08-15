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
fn run_ytdl(args: &[String], timeout: Duration) -> Result<String, String> {
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

/// `--cookies-from-browser` 允许的浏览器白名单（防注入任意参数值）。
const COOKIE_BROWSERS: &[&str] = &[
    "safari", "chrome", "chromium", "firefox", "edge", "brave", "arc", "orca", "opera", "vivaldi",
];

/// 规范化 Cookie 来源：空/None → None（无 Cookie），白名单外报错。
fn normalize_cookie_browser(cookies: Option<String>) -> Result<Option<String>, String> {
    match cookies
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty())
    {
        None => Ok(None),
        Some(name) if COOKIE_BROWSERS.contains(&name.as_str()) => Ok(Some(name)),
        Some(name) => Err(format!("不支持的 Cookie 浏览器: {name}")),
    }
}

/// 基础参数前插入 `--cookies-from-browser <name>`（仅当有 Cookie 来源）。
fn with_cookies(base: &[&str], cookies: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = Vec::with_capacity(base.len() + 2);
    if let Some(browser) = cookies {
        args.push("--cookies-from-browser".to_string());
        args.push(browser.to_string());
    }
    args.extend(base.iter().map(|s| (*s).to_string()));
    args
}

/// 反爬拦截提示：未用 Cookie 且命中 YouTube bot 检测时追加操作指引。
fn bot_hint(err: String, has_cookies: bool) -> String {
    if !has_cookies && (err.contains("Sign in to confirm") || err.contains("not a bot")) {
        format!("{err}（YouTube 反爬拦截：请将 Cookie 来源设为 Safari/Chrome 后重试）")
    } else {
        err
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

/// YouTube 搜索（yt-dlp sidecar，可选浏览器 Cookie 防反爬）。
#[tauri::command]
pub async fn ytdl_search(
    query: String,
    limit: Option<u32>,
    cookies: Option<String>,
) -> Result<Vec<YtTrack>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 30);
    let cookies = normalize_cookie_browser(cookies)?;
    let has_cookies = cookies.is_some();
    tauri::async_runtime::spawn_blocking(move || {
        let spec = format!("ytsearch{limit}:{query}");
        let output = run_ytdl(
            &with_cookies(
                &["--flat-playlist", "-J", "--no-warnings", &spec],
                cookies.as_deref(),
            ),
            SEARCH_TIMEOUT,
        )
        .map_err(|e| bot_hint(e, has_cookies))?;
        parse_ytdl_search(&output)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 取流地址（强制 m4a/AAC——WKWebView 不支持 Opus/WebM；可选浏览器 Cookie）。
#[tauri::command]
pub async fn ytdl_url(video_id: String, cookies: Option<String>) -> Result<String, String> {
    let cookies = normalize_cookie_browser(cookies)?;
    let has_cookies = cookies.is_some();
    tauri::async_runtime::spawn_blocking(move || {
        let watch = format!("https://www.youtube.com/watch?v={video_id}");
        let output = run_ytdl(
            &with_cookies(
                &[
                    "-f",
                    "bestaudio[ext=m4a]/bestaudio",
                    "-g",
                    "--no-warnings",
                    &watch,
                ],
                cookies.as_deref(),
            ),
            URL_TIMEOUT,
        )
        .map_err(|e| bot_hint(e, has_cookies))?;
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

/// 时间戳 "HH:MM:SS.mmm" → LRC 标记 "[mm:ss.xx]"。
fn format_timestamp(start: &str) -> Option<String> {
    let mut it = start.split(':');
    let h: u64 = it.next()?.trim().parse().ok()?;
    let m: u64 = it.next()?.trim().parse().ok()?;
    let s: f64 = it.next()?.trim().parse().ok()?;
    let total_secs = (h * 3600 + m * 60) as f64 + s;
    let mm = (total_secs / 60.0).floor() as u64;
    let ss = total_secs % 60.0;
    Some(format!("[{mm:02}:{ss:05.2}]"))
}

/// 去除 VTT 行内标签（<c>、</c> 等）。
fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if c == '<' {
            in_tag = true;
            continue;
        }
        if c == '>' {
            in_tag = false;
            continue;
        }
        if !in_tag {
            out.push(c);
        }
    }
    out
}

/// VTT 字幕 → LRC（纯函数可单测）：cue 多行文本拼接、去标签、跳过头部元数据。
pub fn vtt_to_lrc(vtt: &str) -> String {
    let mut out = String::new();
    let mut pending_text: Vec<String> = Vec::new();
    let mut last_time: Option<String> = None;
    let flush = |out: &mut String, time: &mut Option<String>, text: &mut Vec<String>| {
        if let Some(t) = time.take() {
            let joined = text.join(" ").trim().to_string();
            if !joined.is_empty() {
                out.push_str(&t);
                out.push_str(&joined);
                out.push('\n');
            }
        }
        text.clear();
    };
    for raw in vtt.lines() {
        let line = raw.trim();
        if line.is_empty() {
            flush(&mut out, &mut last_time, &mut pending_text);
            continue;
        }
        if line.starts_with("WEBVTT")
            || line.starts_with("Kind:")
            || line.starts_with("Language:")
            || line == "NOTE"
            || line.starts_with("NOTE ")
        {
            continue;
        }
        if line.contains("-->") {
            let start = line.split("-->").next().unwrap_or("").trim();
            if let Some(t) = format_timestamp(start) {
                flush(&mut out, &mut last_time, &mut pending_text);
                last_time = Some(t);
            }
            continue;
        }
        let text = strip_tags(line);
        if !text.is_empty() {
            pending_text.push(text);
        }
    }
    flush(&mut out, &mut last_time, &mut pending_text);
    out
}

/// YouTube 字幕歌词（yt-dlp 抓取 VTT → LRC；无字幕返回 None；可选浏览器 Cookie）。
#[tauri::command]
pub async fn ytdl_lyrics(
    video_id: String,
    cookies: Option<String>,
) -> Result<Option<String>, String> {
    let cookies = normalize_cookie_browser(cookies)?;
    tauri::async_runtime::spawn_blocking(move || {
        let tmp_dir = std::env::temp_dir().join(format!("likey-lyrics-{}", std::process::id()));
        std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
        let prefix = tmp_dir.join("sub");
        let watch = format!("https://www.youtube.com/watch?v={video_id}");
        let _ = run_ytdl(
            &with_cookies(
                &[
                    "--skip-download",
                    "--write-subs",
                    "--write-auto-subs",
                    "--sub-format",
                    "vtt",
                    "--no-warnings",
                    "-o",
                    prefix.to_str().unwrap_or("sub"),
                    &watch,
                ],
                cookies.as_deref(),
            ),
            SEARCH_TIMEOUT,
        );
        let mut found: Option<String> = None;
        if let Ok(entries) = std::fs::read_dir(&tmp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|x| x.to_str()) == Some("vtt") {
                    if let Ok(text) = std::fs::read_to_string(&path) {
                        found = Some(vtt_to_lrc(&text));
                        break;
                    }
                }
            }
        }
        let _ = std::fs::remove_dir_all(&tmp_dir);
        Ok(found.filter(|s| !s.trim().is_empty()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vtt_to_lrc_converts_and_strips_tags() {
        let vtt = "WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.300 --> 00:00:19.200\nqíng tiān zhōu jié lún\n\n00:00:28.000 --> 00:00:34.800\n<c>gù shì</c> de xiǎo huáng huā\nsecond line\n";
        let lrc = vtt_to_lrc(vtt);
        assert!(lrc.contains("[00:00.30]qíng tiān zhōu jié lún"));
        assert!(lrc.contains("[00:28.00]gù shì de xiǎo huáng huā second line"));
        assert!(!lrc.contains("WEBVTT"));
        assert!(!lrc.contains("<c>"));
    }

    #[test]
    fn vtt_to_lrc_handles_empty() {
        assert_eq!(vtt_to_lrc("WEBVTT\n"), "");
        assert_eq!(vtt_to_lrc(""), "");
    }

    #[test]
    fn format_timestamp_outputs_lrc_marks() {
        assert_eq!(
            format_timestamp("00:01:05.500").as_deref(),
            Some("[01:05.50]")
        );
        assert_eq!(
            format_timestamp("01:02:03.000").as_deref(),
            Some("[62:03.00]")
        );
    }

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

    #[test]
    fn normalize_cookie_browser_whitelist() {
        assert_eq!(normalize_cookie_browser(None).unwrap(), None);
        assert_eq!(normalize_cookie_browser(Some(String::new())).unwrap(), None);
        assert_eq!(
            normalize_cookie_browser(Some(" Safari ".to_string()))
                .unwrap()
                .as_deref(),
            Some("safari")
        );
        assert_eq!(
            normalize_cookie_browser(Some("Chrome".to_string()))
                .unwrap()
                .as_deref(),
            Some("chrome")
        );
        assert!(normalize_cookie_browser(Some("steam".to_string())).is_err());
    }

    #[test]
    fn with_cookies_prepends_browser_flag() {
        assert_eq!(
            with_cookies(&["-J", "x"], Some("chrome")),
            vec!["--cookies-from-browser", "chrome", "-J", "x"]
        );
        assert_eq!(with_cookies(&["-J", "x"], None), vec!["-J", "x"]);
    }

    #[test]
    fn bot_hint_only_without_cookies() {
        let err = "yt-dlp 失败: ERROR: Sign in to confirm you're not a bot".to_string();
        assert!(bot_hint(err.clone(), false).contains("反爬"));
        assert_eq!(bot_hint(err.clone(), true), err);
        assert_eq!(
            bot_hint("yt-dlp 失败: 其他错误".to_string(), false),
            "yt-dlp 失败: 其他错误"
        );
    }
}
