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

/// 把曲目元数据写入文件标签（标题/艺术家/专辑/封面/歌词）：
/// 文件名只管人读，机器识别靠内嵌标签，任何播放器扫描都准确。
/// 不支持的容器（如 ADTS 裸流）静默跳过。
fn write_metadata_tags(
    path: &Path,
    title: &str,
    artist: &str,
    album: &str,
    artwork: Option<&[u8]>,
    artwork_mime: Option<&str>,
    lyrics: Option<&str>,
) {
    let Ok(mut tagged) = lofty::read_from_path(path) else {
        return;
    };
    let set_fields = |tag: &mut Tag| {
        tag.insert_text(ItemKey::TrackTitle, title.to_string());
        if !artist.is_empty() {
            tag.insert_text(ItemKey::TrackArtist, artist.to_string());
        }
        if !album.is_empty() {
            tag.insert_text(ItemKey::AlbumTitle, album.to_string());
        }
        if let Some(bytes) = artwork {
            let mime = match artwork_mime.unwrap_or("") {
                "image/png" => lofty::picture::MimeType::Png,
                "image/gif" => lofty::picture::MimeType::Gif,
                "image/bmp" => lofty::picture::MimeType::Bmp,
                other => lofty::picture::MimeType::Unknown(other.to_string()),
            };
            let picture = lofty::picture::Picture::new_unchecked(
                lofty::picture::PictureType::CoverFront,
                Some(mime),
                None,
                bytes.to_vec(),
            );
            tag.push_picture(picture);
        }
        if let Some(text) = lyrics {
            tag.insert_text(ItemKey::Lyrics, text.to_string());
        }
    };
    if tagged.primary_tag().is_some() {
        if let Some(tag) = tagged.primary_tag_mut() {
            set_fields(tag);
        }
    } else {
        let mut tag = Tag::new(tagged.primary_tag_type());
        set_fields(&mut tag);
        tagged.insert_tag(tag);
    }
    let _ = tagged.save_to_path(path, WriteOptions::default());
}

/// 抓取封面图片（小文件，10MB 上限）；失败静默返回 None（不阻断下载）。
async fn fetch_artwork(client: &reqwest::Client, url: &str) -> Option<(Vec<u8>, String)> {
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    if response.content_length().unwrap_or(0) > 10 * 1024 * 1024 {
        return None;
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = response.bytes().await.ok()?;
    if bytes.len() > 10 * 1024 * 1024 {
        return None;
    }
    Some((bytes.to_vec(), mime))
}

/// 下载音源曲目到 ~/Music/Mymusic，返回音频路径与封面路径。
/// 已存在同内容（按最终文件名）则直接返回；流式写入并经 Channel 推送进度；
/// 元数据（title/artist/album/artwork_url/lyrics）在下载完成后写入文件标签，
/// 封面同时落盘 covers/ 供旁路档案引用。
#[tauri::command]
pub async fn download_file(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
    on_progress: Channel<DownloadProgress>,
    meta: Option<crate::models::DownloadMeta>,
) -> Result<crate::models::DownloadResult, String> {
    let meta = meta.unwrap_or_default();
    let dir = downloads_dir(&app)?;
    let base = sanitize_file_name(&file_name);
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| e.to_string())?;
    let is_gv = url.contains("googlevideo.com");
    let response = if is_gv {
        None
    } else {
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("下载请求失败: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("下载失败: HTTP {}", response.status().as_u16()));
        }
        Some(response)
    };
    let content_type = response.as_ref().and_then(|r| {
        r.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    });
    // googlevideo 由 yt-dlp 强制选 m4a/AAC；其余按响应推断
    let ext = if is_gv {
        "m4a".to_string()
    } else {
        infer_extension(content_type.as_deref(), &url)
    };
    let mut final_name = if base.to_ascii_lowercase().ends_with(&format!(".{ext}")) {
        base
    } else {
        format!("{base}.{ext}")
    };
    let mut path = dir.join(&final_name);
    if path.is_file() {
        return Ok(crate::models::DownloadResult {
            path: path.to_string_lossy().to_string(),
            artwork_path: None,
        });
    }

    if is_gv {
        // googlevideo 拒绝无 Range 整包请求 → 分块小 Range 抓取（浏览器同款策略）
        download_chunked(&client, &url, &path, &on_progress).await?;
    } else {
        let response = response.expect("非 googlevideo 必有响应");
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
    }

    // 转码 MP3（可选）：访达对 m4a 内嵌封面显示不稳，mp3(ID3) 稳定
    if should_transcode(&meta, &ext, ffmpeg_available()) {
        let mp3_path = transcode_to_mp3(&path).await?;
        final_name = mp3_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&final_name)
            .to_string();
        path = mp3_path;
        let _ = on_progress.send(DownloadProgress {
            downloaded: 1,
            total: 1,
        });
    }

    // 封面：抓取 → 落盘 covers/ → 嵌入标签
    let artwork = match meta.artwork_url.as_deref().filter(|u| !u.is_empty()) {
        Some(art_url) => fetch_artwork(&client, art_url).await,
        None => None,
    };
    let artwork_path = if let Some((bytes, _mime)) = artwork.as_ref() {
        let covers = dir.join("covers");
        if std::fs::create_dir_all(&covers).is_ok() {
            let stem = final_name
                .rsplit_once('.')
                .map(|(stem, _)| stem)
                .unwrap_or(&final_name)
                .to_string();
            let cover_path = covers.join(format!("{stem}.jpg"));
            if std::fs::write(&cover_path, bytes).is_ok() {
                Some(cover_path.to_string_lossy().to_string())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    if let Some(t) = meta.title.as_deref().filter(|t| !t.trim().is_empty()) {
        let (bytes, mime) = artwork
            .as_ref()
            .map(|(bytes, mime)| (bytes.as_slice(), mime.as_str()))
            .unwrap_or((&[][..], ""));
        write_metadata_tags(
            &path,
            t.trim(),
            meta.artist.as_deref().unwrap_or(""),
            meta.album.as_deref().unwrap_or(""),
            (!bytes.is_empty()).then_some(bytes),
            (!mime.is_empty()).then_some(mime),
            meta.lyrics.as_deref(),
        );
    }
    Ok(crate::models::DownloadResult {
        path: path.to_string_lossy().to_string(),
        artwork_path,
    })
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

const GV_CHUNK_SIZE: u64 = 512 * 1024;

/// 转码决策：显式要求 + m4a 源 + ffmpeg 可用（纯函数可单测）。
pub fn should_transcode(
    meta: &crate::models::DownloadMeta,
    ext: &str,
    ffmpeg_available: bool,
) -> bool {
    meta.transcode_mp3.unwrap_or(false) && ext == "m4a" && ffmpeg_available
}

fn ffmpeg_available() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// m4a → mp3（ffmpeg/libmp3lame 192k）；成功后替换原文件。
async fn transcode_to_mp3(path: &Path) -> Result<PathBuf, String> {
    let mp3_path = path.with_extension("mp3");
    // 临时文件必须保留可识别的 .mp3 扩展名（ffmpeg 依扩展名推断输出容器）
    let tmp_path = path.with_extension("transcoding.mp3");
    let output = tauri::async_runtime::spawn_blocking({
        let input = path.to_path_buf();
        let tmp = tmp_path.clone();
        move || {
            std::process::Command::new("ffmpeg")
                .args([
                    "-y",
                    "-i",
                    input.to_str().unwrap_or(""),
                    "-vn",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                    "-f",
                    "mp3",
                    tmp.to_str().unwrap_or(""),
                ])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .output()
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&tmp_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let last = stderr.lines().last().unwrap_or("未知错误");
        return Err(format!("转码 mp3 失败（ffmpeg）: {last}"));
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, &mp3_path).map_err(|e| e.to_string())?;
    Ok(mp3_path)
}

/// 解析 Content-Range 总长："bytes 0-1023/5152105" → 5152105。
fn parse_content_range_total(value: Option<&str>) -> Option<u64> {
    value?.rsplit('/').next()?.parse().ok()
}

/// 全文件分块区间 [start, end]（含端点）。
fn chunk_ranges(total: u64, chunk_size: u64) -> Vec<(u64, u64)> {
    let mut ranges = Vec::new();
    let mut start = 0u64;
    while start < total {
        let end = std::cmp::min(start + chunk_size - 1, total - 1);
        ranges.push((start, end));
        start = end + 1;
    }
    ranges
}

/// googlevideo 分块抓取：探测总长 → 逐块有限 Range 请求写入文件。
async fn download_chunked(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    on_progress: &Channel<DownloadProgress>,
) -> Result<(), String> {
    let probe = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {e}"))?;
    if !probe.status().is_success() {
        return Err(format!("下载失败: HTTP {}", probe.status().as_u16()));
    }
    let total = parse_content_range_total(
        probe
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok()),
    )
    .or_else(|| probe.content_length())
    .ok_or_else(|| "无法确定文件总长（无 Content-Range）".to_string())?;

    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    for (start, end) in chunk_ranges(total, GV_CHUNK_SIZE) {
        let range = format!("bytes={start}-{end}");
        let response = client
            .get(url)
            .header(reqwest::header::RANGE, &range)
            .send()
            .await
            .map_err(|e| format!("分块下载失败: {e}"))?;
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!("分块下载失败: HTTP {}", response.status().as_u16()));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
        let _ = on_progress.send(DownloadProgress { downloaded, total });
    }
    Ok(())
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

    #[test]
    fn chunk_ranges_cover_whole_file() {
        assert_eq!(chunk_ranges(10, 4), vec![(0, 3), (4, 7), (8, 9)]);
        assert_eq!(chunk_ranges(3, 4), vec![(0, 2)]);
        assert_eq!(chunk_ranges(8, 4), vec![(0, 3), (4, 7)]);
    }

    #[test]
    fn parse_content_range_extracts_total() {
        assert_eq!(
            parse_content_range_total(Some("bytes 0-0/5152105")),
            Some(5152105)
        );
        assert_eq!(parse_content_range_total(Some("garbage")), None);
        assert_eq!(parse_content_range_total(None), None);
    }

    #[test]
    fn should_transcode_matrix() {
        let mut meta = crate::models::DownloadMeta::default();
        assert!(!should_transcode(&meta, "m4a", true));
        meta.transcode_mp3 = Some(true);
        assert!(should_transcode(&meta, "m4a", true));
        assert!(!should_transcode(&meta, "m4a", false)); // 无 ffmpeg
        assert!(!should_transcode(&meta, "mp3", true)); // 非 m4a
        assert!(!should_transcode(&meta, "flac", true));
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
        write_metadata_tags(
            &tmp,
            "晴天",
            "周杰伦",
            "叶惠美",
            Some(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg"),
            Some("[00:01.00]歌词"),
        );

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
        assert_eq!(tag.pictures().len(), 1);
        assert_eq!(tag.get_string(&ItemKey::Lyrics), Some("[00:01.00]歌词"));
        let _ = std::fs::remove_file(&tmp);
    }
}
