use std::path::PathBuf;

use tauri::ipc::Channel;

use crate::commands::metadata::{is_audio_file, read_metadata_impl};
use crate::models::{ScanProgress, TrackMeta};

/// 扫描目录下全部音频文件的元数据（阻塞 IO 放后台线程，进度经 Channel 推送）。
#[tauri::command]
pub async fn scan_directory(
    path: String,
    recursive: bool,
    on_progress: Channel<ScanProgress>,
) -> Result<Vec<TrackMeta>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("不是有效目录: {path}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let entries: Vec<PathBuf> = if recursive {
            walkdir::WalkDir::new(&root)
                .follow_links(false)
                .into_iter()
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.into_path())
                .filter(|p| p.is_file() && is_audio_file(p))
                .collect()
        } else {
            std::fs::read_dir(&root)
                .map_err(|e| e.to_string())?
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|p| p.is_file() && is_audio_file(p))
                .collect()
        };
        let total = entries.len() as u32;
        let mut metas = Vec::with_capacity(entries.len());
        for (i, entry) in entries.iter().enumerate() {
            if let Ok(meta) = read_metadata_impl(entry) {
                metas.push(meta);
            }
            let _ = on_progress.send(ScanProgress {
                done: (i + 1) as u32,
                total,
            });
        }
        Ok(metas)
    })
    .await
    .map_err(|e| e.to_string())?
}
