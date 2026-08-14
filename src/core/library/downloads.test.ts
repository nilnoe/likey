import { describe, expect, it } from 'vitest'
import { buildDownloadFileName, fixLegacyDownloadPath } from './downloads'

describe('buildDownloadFileName', () => {
  it('combines singer and name with  - ', () => {
    expect(buildDownloadFileName('周杰伦', '晴天')).toBe('周杰伦 - 晴天')
  })

  it('falls back to name when singer empty', () => {
    expect(buildDownloadFileName('', '晴天')).toBe('晴天')
    expect(buildDownloadFileName('   ', '晴天')).toBe('晴天')
  })

  it('falls back to placeholder when name empty', () => {
    expect(buildDownloadFileName('某人', '')).toBe('某人 - 未命名曲目')
  })
})

describe('fixLegacyDownloadPath', () => {
  it('rewrites legacy app-data paths to the new dir', () => {
    expect(
      fixLegacyDownloadPath(
        '/Users/mike/Library/Application Support/com.likey.app/downloads/audius-xx.mp3',
        '/Users/mike/Music/Mymusic',
      ),
    ).toBe('/Users/mike/Music/Mymusic/audius-xx.mp3')
  })

  it('leaves non-legacy paths untouched', () => {
    expect(fixLegacyDownloadPath('/Users/mike/Music/Mymusic/a.mp3', '/x/y')).toBe(
      '/Users/mike/Music/Mymusic/a.mp3',
    )
  })

  it('handles trailing slashes in new dir', () => {
    expect(
      fixLegacyDownloadPath(
        '/Users/m/Library/Application Support/com.likey.app/downloads/b.mp3',
        '/Users/m/Music/Mymusic/',
      ),
    ).toBe('/Users/m/Music/Mymusic/b.mp3')
  })
})
