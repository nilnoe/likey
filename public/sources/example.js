// Likey 内置示例音源：搜索并播放「本地音乐库」。
// 演示 lx-music 兼容协议：window.source = { search, getMusicUrl, getLyric }
// 曲库数据由主线程经 { type: 'config' } 消息注入。
var library = []

window.addEventListener('message', function (event) {
  var data = event.data
  if (data && data.type === 'config' && Array.isArray(data.payload)) {
    library = data.payload
  }
})

window.source = {
  search: function (keyword, page, limit) {
    var kw = String(keyword || '').toLowerCase()
    var matched = library.filter(function (t) {
      if (kw === '') return true
      return t.title.toLowerCase().indexOf(kw) >= 0 || t.artist.toLowerCase().indexOf(kw) >= 0
    })
    var start = (Math.max(1, page || 1) - 1) * (limit || 30)
    return matched.slice(start, start + (limit || 30)).map(function (t) {
      return {
        songmid: t.id,
        name: t.title,
        singer: t.artist,
        album: t.album,
        interval: Math.round(t.duration),
        img: '',
        source: 'likey-local',
      }
    })
  },
  getMusicUrl: function (songmid) {
    var found = null
    for (var i = 0; i < library.length; i++) {
      if (library[i].id === songmid) {
        found = library[i]
        break
      }
    }
    return found ? found.fileUrl : null
  },
  getLyric: function () {
    return null
  },
}
