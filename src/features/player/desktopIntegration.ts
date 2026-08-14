import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type TrayCommand = 'toggle' | 'prev' | 'next'

/** 托盘菜单命令监听（纯 Web 环境静默返回 null）。 */
export async function listenTrayCommands(
  handler: (command: TrayCommand) => void,
): Promise<UnlistenFn | null> {
  try {
    return await listen<TrayCommand>('tray-command', (event) => {
      handler(event.payload)
    })
  } catch {
    return null
  }
}

/** 全局快捷键监听（CmdOrCtrl+Shift+Space → 播放/暂停）。 */
export async function listenGlobalShortcut(handler: () => void): Promise<UnlistenFn | null> {
  try {
    return await listen<string>('global-shortcut', () => {
      handler()
    })
  } catch {
    return null
  }
}

/** 系统媒体会话（Now Playing / 媒体键）：metadata 与动作处理器。 */
export function configureMediaSession(actions: {
  toggle(): void
  next(): void
  prev(): void
  seekBy(seconds: number): void
}): void {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.setActionHandler('play', () => {
    actions.toggle()
  })
  navigator.mediaSession.setActionHandler('pause', () => {
    actions.toggle()
  })
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    actions.prev()
  })
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    actions.next()
  })
  navigator.mediaSession.setActionHandler('seekbackward', () => {
    actions.seekBy(-10)
  })
  navigator.mediaSession.setActionHandler('seekforward', () => {
    actions.seekBy(10)
  })
}

/** 更新系统媒体信息（空闲时置空）。 */
export function updateMediaMetadata(trackName: string | null, playing: boolean): void {
  if (!('mediaSession' in navigator)) return
  if (trackName === null) {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
    return
  }
  const [title, artist] = trackName.split(' - ')
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title ?? trackName,
    artist: artist ?? 'Likey',
    album: 'Likey',
  })
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
}
