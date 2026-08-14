// Likey 内置音源：iTunes 试听（30 秒片段，覆盖主流曲库，无需密钥）。
// 协议：lx-music 兼容（window.source = { search, getMusicUrl, getLyric }）
// 注意：仅提供预览片段（平台限制），完整曲目请用其他音源。
var ITUNES_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

function itunesFetch(url) {
  return fetch(url, { headers: { 'User-Agent': ITUNES_UA } }).then(function (r) {
    if (!r.ok) throw new Error('iTunes HTTP ' + r.status)
    return r.json()
  })
}

window.source = {
  search: function (keyword, page, limit) {
    var offset = (Math.max(1, page || 1) - 1) * (limit || 30)
    var query =
      'https://itunes.apple.com/search?term=' +
      encodeURIComponent(keyword || '') +
      '&media=music&entity=song&limit=' +
      (limit || 30) +
      '&offset=' +
      offset
    return itunesFetch(query).then(function (data) {
      return (data.results || []).map(function (t) {
        return {
          songmid: String(t.trackId),
          name: t.trackName || '未知曲目',
          singer: t.artistName || '',
          album: t.collectionName || '',
          interval: Math.round((t.trackTimeMillis || 0) / 1000),
          img: t.artworkUrl100 || '',
          source: 'itunes-preview',
        }
      })
    })
  },
  getMusicUrl: function (songmid) {
    return itunesFetch('https://itunes.apple.com/lookup?id=' + encodeURIComponent(songmid)).then(
      function (data) {
        var track = data.results && data.results[0]
        return track && track.previewUrl ? track.previewUrl : null
      },
    )
  },
  getLyric: function () {
    return null
  },
}
