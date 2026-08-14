use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::{ItemKey, Tag};
use tauri::ipc::Channel;
use tauri::Manager;

use crate::models::DownloadProgress;

const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/// 下载目录：~/Music/Mymusic（用户可见，随音乐生态一起备份）。
pub fn mymusic_dir(home: &Path) -> PathBuf {
    home.join("Music").join("Mymusic")
}

fn downloads_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = mymusic_dir(&home);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    migrate_legacy(app, &dir);
    Ok(dir)
}

/// 一次性迁移：旧应用数据目录下的下载文件搬到 ~/Music/Mymusic。
fn migrate_legacy(app: &tauri::AppHandle, new_dir: &Path) {
    let Ok(legacy) = app.path().app_data_dir() else {
        return;
    };
    let legacy = legacy.join("downloads");
    if !legacy.is_dir() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(&legacy) {
        for entry in entries.flatten() {
            let src = entry.path();
            if !src.is_file() {
                continue;
            }
            let Some(name) = src.file_name() else {
                continue;
            };
            let dst = new_dir.join(name);
            if !dst.exists() {
                let _ = std::fs::rename(&src, &dst);
            }
        }
    }
    // 仅当目录已空时移除成功
    let _ = std::fs::remove_dir(&legacy);
}

/// 返回当前下载目录路径（前端迁移/展示用）。
#[tauri::command]
pub fn get_downloads_dir(app: tauri::AppHandle) -> Result<String, String> {
    downloads_dir(&app).map(|dir| dir.to_string_lossy().to_string())
}

/// 安全文件名：仅保留字母数字、中文、空格、`-_.()`，其余替换为 `_`。
pub fn sanitize_file_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_alphanumeric() || matches!(ch, '-' | '_' | '.' | '(' | ')' | ' ') || !ch.is_ascii()
        {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches(|c| c == '.' || c == ' ').to_string();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed
    }
}

/// 扩展名推断：Content-Type 优先，其次 URL 路径，兜底 mp3。
pub fn infer_extension(content_type: Option<&str>, url: &str) -> String {
    if let Some(ct) = content_type {
        let ct = ct
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        match ct.as_str() {
            "audio/mpeg" | "audio/mp3" => return "mp3".to_string(),
            "audio/mp4" | "audio/x-m4a" | "audio/aac" => return "m4a".to_string(),
            "audio/flac" | "audio/x-flac" => return "flac".to_string(),
            "audio/wav" | "audio/x-wav" | "audio/wave" => return "wav".to_string(),
            "audio/ogg" | "application/ogg" => return "ogg".to_string(),
            _ => {}
        }
    }
    if let Some(ext) = Path::new(url.split(['?', '#']).next().unwrap_or(""))
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        if matches!(ext.as_str(), "mp3" | "m4a" | "flac" | "wav" | "ogg") {
            return ext;
        }
    }
    "mp3".to_string()
}

/// 把曲目元数据写入文件标签（标题/艺术家/专辑）：
/// 文件名只管人读，机器识别靠内嵌标签，任何播放器扫描都准确。
/// 不支持的容器（如 ADTS 裸流）静默跳过。
fn write_metadata_tags(path: &Path, title: &str, artist: &str, album: &str) {
    let Ok(mut tagged) = lofty::read_from_path(path) else {
        return;
    };
    let set_texts = |tag: &mut Tag| {
        tag.insert_text(ItemKey::TrackTitle, title.to_string());
        if !artist.is_empty() {
            tag.insert_text(ItemKey::TrackArtist, artist.to_string());
        }
        if !album.is_empty() {
            tag.insert_text(ItemKey::AlbumTitle, album.to_string());
        }
    };
    if tagged.primary_tag().is_some() {
        if let Some(tag) = tagged.primary_tag_mut() {
            set_texts(tag);
        }
    } else {
        let mut tag = Tag::new(tagged.primary_tag_type());
        set_texts(&mut tag);
        tagged.insert_tag(tag);
    }
    let _ = tagged.save_to_path(path, WriteOptions::default());
}

/// 下载音源曲目到 ~/Music/Mymusic，返回绝对路径。
/// 已存在同内容（按最终文件名）则直接返回；流式写入并经 Channel 推送进度；
/// 可选元数据（title/artist/album）在下载完成后写入文件标签。
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
    on_progress: Channel<DownloadProgress>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
) -> Result<String, String> {
    let dir = downloads_dir(&app)?;
    let base = sanitize_file_name(&file_name);
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status().as_u16()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let ext = infer_extension(content_type.as_deref(), &url);
    let final_name = if base.to_ascii_lowercase().ends_with(&format!(".{ext}")) {
        base
    } else {
        format!("{base}.{ext}")
    };
    let path = dir.join(&final_name);
    if path.is_file() {
        return Ok(path.to_string_lossy().to_string());
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = on_progress.send(DownloadProgress { downloaded, total });
    }
    if let Some(t) = title.filter(|t| !t.trim().is_empty()) {
        write_metadata_tags(
            &path,
            t.trim(),
            artist.as_deref().unwrap_or(""),
            album.as_deref().unwrap_or(""),
        );
    }
    Ok(path.to_string_lossy().to_string())
}

/// 删除下载文件（路径必须在 downloads 目录内，防越界删除）。
#[tauri::command]
pub fn delete_download(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = downloads_dir(&app)?;
    let target = PathBuf::from(&path);
    if !target.starts_with(&dir) {
        return Err("路径不在下载目录内，已拒绝删除".to_string());
    }
    std::fs::remove_file(&target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mymusic_dir_joins_home() {
        assert_eq!(
            mymusic_dir(Path::new("/Users/mike")),
            PathBuf::from("/Users/mike/Music/Mymusic")
        );
    }

    #[test]
    fn sanitize_keeps_safe_chars_and_chinese() {
        assert_eq!(sanitize_file_name("vZJJz"), "vZJJz");
        assert_eq!(sanitize_file_name("晴天 - 周杰伦"), "晴天 - 周杰伦");
        assert_eq!(sanitize_file_name("a/b\\c:d*e?f"), "a_b_c_d_e_f");
        assert_eq!(sanitize_file_name("..."), "download");
        assert_eq!(sanitize_file_name(""), "download");
    }

    #[test]
    fn infer_ext_from_content_type() {
        assert_eq!(infer_extension(Some("audio/mpeg"), "https://x/y"), "mp3");
        assert_eq!(
            infer_extension(Some("audio/mpeg; charset=utf-8"), "https://x/y"),
            "mp3"
        );
        assert_eq!(infer_extension(Some("audio/mp4"), "https://x/y"), "m4a");
        assert_eq!(infer_extension(Some("audio/flac"), "https://x/y"), "flac");
        assert_eq!(infer_extension(Some("text/html"), "https://x/y"), "mp3");
    }

    #[test]
    fn infer_ext_falls_back_to_url_then_mp3() {
        assert_eq!(infer_extension(None, "https://x/song.m4a?sig=1"), "m4a");
        assert_eq!(infer_extension(None, "https://x/stream"), "mp3");
    }

    /// 集成测试：往真实 mp3（无标签测试音）写入元数据后可被读回。
    #[test]
    fn write_metadata_tags_roundtrip() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/fixtures/tone.mp3");
        let tmp_dir = std::env::current_dir()
            .expect("cwd")
            .join("target/tmp-test");
        std::fs::create_dir_all(&tmp_dir).expect("create tmp dir");
        let tmp = tmp_dir.join(format!("likey-tag-test-{}.mp3", std::process::id()));
        std::fs::copy(&fixture, &tmp).expect("copy fixture");
        write_metadata_tags(&tmp, "晴天", "周杰伦", "叶惠美");

        let tagged = lofty::read_from_path(&tmp).expect("read back");
        let tag = tagged.primary_tag().expect("id3v2 tag written");
        use lofty::prelude::Accessor;
        assert_eq!(tag.title().map(|s| s.to_string()).as_deref(), Some("晴天"));
        assert_eq!(
            tag.artist().map(|s| s.to_string()).as_deref(),
            Some("周杰伦")
        );
        assert_eq!(
            tag.album().map(|s| s.to_string()).as_deref(),
            Some("叶惠美")
        );
        let _ = std::fs::remove_file(&tmp);
    }
}
