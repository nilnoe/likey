# Likey

千千静听（TTPlayer）风格的律动音乐播放器。本地音乐库 + 频谱律动可视化 + LRC 歌词 + 皮肤系统。

- 技术栈：Tauri 2 + React 19 + Vite + TypeScript（strict）
- 设计文档：[docs/DESIGN.md](docs/DESIGN.md)
- 开发纪律与质量门：[AGENTS.md](AGENTS.md)

## 开发

```bash
source .devrc       # 重定向包管理缓存到仓库内（沙箱环境必须）
pnpm install
pnpm tauri dev      # 桌面运行
pnpm dev            # 纯 Web 调试（浏览器）
```

## 质量门

```bash
pnpm gate           # G1 静态（oxlint/tsc/prettier）+ G2 测试（Vitest 覆盖率）+ G3 构建
```

## S0 Spike 验收清单（G4）

- [ ] `pnpm tauri dev` 窗口正常打开
- [ ] 打开本地 mp3 / flac / wav 可播放，seek / 音量 / 暂停正常
- [ ] 频谱柱随音乐律动，鼓点触发脉冲
- [ ] 格式探测面板：mp3 / wav 应为 ✅；FLAC 结果决定 WASM 兜底是否进 MVP（macOS WKWebView 风险点）
