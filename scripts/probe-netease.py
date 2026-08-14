#!/usr/bin/env python3
# 网易云 weapi 探测：验证搜索/取流端点与匿名音质（仅本地测试，不用于破解）。
import json
import os
import subprocess
import urllib.request

PRESET_KEY_HEX = "30636f556d364279773857386a7564"  # "0CoJUm6Qyw8W8jud"
IV_HEX = "0102030405060708"
MODULUS = int(
    "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725"
    "152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312"
    "ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424"
    "d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
    16,
)
EXPONENT = 0x010001


def aes_cbc_base64(data: bytes, key_hex: str, iv_hex: str) -> bytes:
    proc = subprocess.run(
        ["openssl", "enc", "-aes-128-cbc", "-K", key_hex, "-iv", iv_hex, "-base64", "-A"],
        input=data,
        capture_output=True,
        check=True,
    )
    return proc.stdout.strip()


def weapi(params: dict) -> dict:
    text = json.dumps(params, separators=(",", ":")).encode()
    sec_key = os.urandom(16).hex()[:16].encode()
    first = aes_cbc_base64(text, PRESET_KEY_HEX, IV_HEX)
    second = aes_cbc_base64(first, sec_key.hex().encode(), IV_HEX)
    # RSA PKCS#1 v1.5: c = m^e mod n
    m = int.from_bytes(sec_key[::-1], "big")
    c = pow(m, EXPONENT, MODULUS)
    enc_sec_key = format(c, "x").zfill(256)
    return {"params": second.decode(), "encSecKey": enc_sec_key}


def post(url: str, data: dict, cookie: str = "") -> bytes:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
            "Referer": "https://music.163.com/",
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": cookie,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read()


def main() -> None:
    # 1. 搜索
    search = weapi({"s": "周杰伦 晴天", "type": 1, "limit": 3, "offset": 0, "total": True})
    raw = post("https://music.163.com/weapi/cloudsearch/get/web", search)
    result = json.loads(raw)
    songs = (result.get("result") or {}).get("songs") or []
    print(f"搜索: code={result.get('code')}, 命中 {len(songs)} 首")
    for s in songs:
        print(f"  {s.get('id')} {s.get('name')} - {s.get('ar', [{}])[0].get('name')}")
    if not songs:
        return
    song_id = songs[0]["id"]
    # 2. 取流：三档音质匿名请求
    for br, label in [(128000, "标准128k"), (320000, "极高320k"), (999000, "无损")]:
        url_params = weapi({"ids": [song_id], "br": br})
        raw = post("https://music.163.com/weapi/song/enhance/player/url", url_params)
        data = json.loads(raw).get("data") or []
        if data and data[0].get("url"):
            u = data[0]
            print(f"  {label}: code=200 url={u.get('url', '')[:70]}... br={u.get('br')} size={u.get('size')} type={u.get('type')}")
        else:
            print(f"  {label}: {json.loads(raw).get('code')} {data[0].get('code') if data else '无数据'}（匿名不可得）")


if __name__ == "__main__":
    main()
