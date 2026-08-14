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
    use super::is_audio_file;
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
}

fn fallback_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("未知曲目")
        .to_string()
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

    let title = tag
        .and_then(|t| t.title().map(|s| s.into_owned()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| fallback_title(path));
    let artist = tag
        .and_then(|t| t.artist().map(|s| s.into_owned()))
        .unwrap_or_else(|| "未知艺术家".to_string());
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
