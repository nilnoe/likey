use std::path::Path;
use std::time::UNIX_EPOCH;

use lofty::prelude::*;
use lofty::probe::Probe;

use crate::models::TrackMeta;

pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "m4a", "aac"];

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{is_audio_file, split_artist_title};
    use std::path::Path;

    #[test]
    fn recognizes_supported_extensions() {
        for ext in ["mp3", "flac", "wav", "m4a", "aac"] {
            assert!(is_audio_file(Path::new(&format!("song.{ext}"))));
        }
        for ext in ["mp4", "ogg", "txt", "jpg"] {
            assert!(!is_audio_file(Path::new(&format!("file.{ext}"))));
        }
    }

    #[test]
    fn splits_artist_title_filenames() {
        assert_eq!(
            split_artist_title("周杰伦 - 晴天"),
            ("周杰伦".to_string(), "晴天".to_string())
        );
        assert_eq!(
            split_artist_title(" 周杰伦 - 晴天 "),
            ("周杰伦".to_string(), "晴天".to_string())
        );
        assert_eq!(
            split_artist_title("晴天"),
            ("未知艺术家".to_string(), "晴天".to_string())
        );
        assert_eq!(
            split_artist_title(" - "),
            ("未知艺术家".to_string(), "-".to_string())
        );
    }
}

/// 文件名解析兜底：「作者 - 歌名」拆分为 (作者, 歌名)；无分隔返回 (未知艺术家, 原名)。
pub fn split_artist_title(stem: &str) -> (String, String) {
    if let Some((artist, title)) = stem.split_once(" - ") {
        let artist = artist.trim();
        let title = title.trim();
        if !artist.is_empty() && !title.is_empty() {
            return (artist.to_string(), title.to_string());
        }
    }
    ("未知艺术家".to_string(), stem.trim().to_string())
}

pub fn read_metadata_impl(path: &Path) -> Result<TrackMeta, String> {
    let tagged_file = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let properties = tagged_file.properties();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    // 标签优先；无标签时按「作者 - 歌名」文件名解析（兜底，不写死规则）
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("未知曲目");
    let (fallback_artist, fallback_title) = split_artist_title(stem);
    let title = tag
        .and_then(|t| t.title().map(|s| s.into_owned()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback_title);
    let artist = tag
        .and_then(|t| t.artist().map(|s| s.into_owned()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback_artist);
    let album = tag
        .and_then(|t| t.album().map(|s| s.into_owned()))
        .unwrap_or_default();
    let has_cover = tag.map(|t| !t.pictures().is_empty()).unwrap_or(false);

    let fs_meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified_ms = fs_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(TrackMeta {
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        duration_secs: properties.duration().as_secs_f64(),
        format: path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .unwrap_or_default(),
        has_cover,
        size_bytes: fs_meta.len(),
        modified_ms,
    })
}

/// 单曲元数据刷新。
#[tauri::command]
pub fn read_metadata(path: String) -> Result<TrackMeta, String> {
    read_metadata_impl(Path::new(&path))
}

/// 读取内嵌封面字节（前端转 Blob URL）。
#[tauri::command]
pub fn read_cover(path: String) -> Result<Vec<u8>, String> {
    let tagged_file = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .ok_or_else(|| "无标签信息".to_string())?;
    let picture = tag
        .pictures()
        .first()
        .ok_or_else(|| "无内嵌封面".to_string())?;
    Ok(picture.data().to_vec())
}
