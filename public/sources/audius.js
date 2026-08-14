// Likey 内置音源：Audius（免费开源音乐平台，无需密钥）。
// 协议：lx-music 兼容（window.source = { search, getMusicUrl, getLyric }）
// 注意：流媒体 CDN 校验 User-Agent，代理会原样透传脚本 headers（reqwest 无浏览器 header 限制）。
var AUDIUS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

function audiusFetch(url) {
  return fetch(url, { headers: { 'User-Agent': AUDIUS_UA } }).then(function (r) {
    if (!r.ok) throw new Error('Audius HTTP ' + r.status)
    return r.json()
  })
}

window.source = {
  search: function (keyword, page, limit) {
    var offset = (Math.max(1, page || 1) - 1) * (limit || 30)
    var query =
      'https://api.audius.co/v1/tracks/search?query=' +
      encodeURIComponent(keyword || '') +
      '&app_name=LIKEY&offset=' +
      offset +
      '&limit=' +
      (limit || 30)
    return audiusFetch(query).then(function (data) {
      return (data.data || []).map(function (t) {
        var artwork = ''
        if (t.artwork) {
          artwork = t.artwork['480x480'] || t.artwork['150x150'] || ''
        }
        return {
          songmid: t.id,
          name: t.title || '未知曲目',
          singer: (t.user && t.user.name) || '未知艺术家',
          album: t.genre || '',
          interval: Math.round(t.duration || 0),
          img: artwork,
          source: 'audius',
        }
      })
    })
  },
  getMusicUrl: function (songmid) {
    return (
      'https://api.audius.co/v1/tracks/' + encodeURIComponent(songmid) + '/stream?app_name=LIKEY'
    )
  },
  getLyric: function () {
    return null
  },
}
