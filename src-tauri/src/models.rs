use serde::Serialize;

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
