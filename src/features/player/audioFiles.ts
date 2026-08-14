const AUDIO_EXT = /\.(mp3|flac|wav|m4a|aac)$/i

/** 按扩展名过滤音频文件（拖放/文件选择共用）。 */
export function filterAudioFiles(files: readonly File[]): File[] {
  return files.filter((file) => AUDIO_EXT.test(file.name))
}
