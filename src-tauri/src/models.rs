use serde::{Deserialize, Serialize};

/// 音轨元数据（与前端 core/library/types.ts 的 TrackMeta 契约对齐）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMeta {
    /// 规范化绝对路径（前端以其哈希作为稳定 id）
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    /// "mp3" | "flac" | "wav"
    pub format: String,
    pub has_cover: bool,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

/// 目录扫描进度事件载荷。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: u32,
    pub total: u32,
}

/// 下载进度事件载荷（total 为 0 表示未知）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

/// 下载结果（音频路径 + 可选封面路径）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub artwork_path: Option<String>,
}

/// 下载元数据（标签写入与封面抓取用；字段均可选）。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub artwork_url: Option<String>,
    pub lyrics: Option<String>,
}

/// YouTube 搜索结果音轨（yt-dlp sidecar 映射）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtTrack {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub duration: u64,
    pub thumbnail: String,
}
