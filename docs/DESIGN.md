# Likey — 律动音乐播放器 · 技术设计文档

> 版本：v1.0（讨论稿）
> 平台：Tauri 2 桌面应用（macOS / Windows）
> 前端：React 18 + Vite + **TypeScript（strict）**，全项目禁用 JS
> 格式：mp3 / flac / wav（MVP）
> 定位：千千静听（TTPlayer）风格的本地音乐播放器，核心卖点为律动可视化 + LRC 歌词 + 皮肤系统

---

## 1. 项目概述

### 1.1 目标

复刻千千静听的核心体验，并赋予现代律动视觉：

| 能力       | 说明                                                |
| ---------- | --------------------------------------------------- |
| 本地音乐库 | 扫描目录、元数据、内嵌封面、虚拟列表、播放列表      |
| 律动可视化 | 经典频谱柱状为主视觉，低频节拍驱动脉冲效果          |
| LRC 歌词   | 解析、同步、卡拉OK 双行渐变、逐字高亮（多时间标签） |
| 皮肤系统   | 皮肤 = JSON 协议，可切换配色与频谱参数              |

### 1.2 设计原则

1. **核心逻辑纯 TS，零框架依赖**：播放内核、分析器、歌词解析、渲染器全部放在 `src/core/`，不 import React。未来换壳（Electron / 纯 Web）零成本。
2. **单一音频时钟**：一切时间（进度、歌词同步、节拍时间戳）以 `AudioContext.currentTime` 为唯一主时钟，禁止 `setTimeout`/`Date.now()` 计时。
3. **渲染与算法解耦**：渲染器只订阅「频谱帧 + 节拍事件」两个数据流，不感知 FFT 细节；节拍检测器只输出事件，不感知渲染。
4. **严格类型**：`tsconfig` 开 `strict: true`，Rust 侧 `TrackMeta` 与前端 `Track` 类型通过同一份字段契约对齐。

### 1.3 开发纪律（对所有开发轮次生效，详见仓库根 `AGENTS.md`）

**纪律一：复用优先，禁止重复造轮子。** 自研前必须过「复用三问」：

1. 有没有健康开源库（活跃维护 + TS 类型 + MIT/Apache 许可）？
2. 是不是产品核心差异化（律动算法、皮肤协议、视觉渲染器）？
3. 引入成本是否明显低于自研？
   —— 仅当问题 1 为「否」且问题 2 为「是」时允许自研；自研模块必须进 `src/core/` 且配套 Vitest 单测。选型审计见 §2.1。

**纪律二：每次开发改动必须过质量门（G1–G4），全绿才算完成：**

| 门      | 内容                            | 工具                                                                                                               |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| G1 静态 | 类型 + 风格零错误               | `tsc -b`(strict + noUncheckedIndexedAccess) · oxlint · Prettier · `cargo clippy -D warnings` · `cargo fmt --check` |
| G2 测试 | 单测全过，core 层覆盖率 ≥ 80%   | Vitest + coverage                                                                                                  |
| G3 构建 | 产物可构建                      | `vite build` · `cargo check`（里程碑：`tauri build`）                                                              |
| G4 验收 | 对照 §17 里程碑验收标准逐条勾验 | 手工 / Spike 清单                                                                                                  |

`pnpm gate` 一键执行 G1–G3；提交前 husky + lint-staged 自动跑改动文件的快速门。

---

## 2. 总体架构

```
┌──────────────────────── Tauri 壳 ────────────────────────┐
│  React SPA（WebView 内，TypeScript）                     │
│                                                          │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │ core/player │──▶│core/analysis │──▶│core/visualizer│ │
│  │ 播放内核    │   │ FFT+节拍检测  │   │ 渲染引擎      │  │
│  └─────────────┘   └──────────────┘   └──────┬───────┘  │
│  ┌─────────────┐   ┌──────────────┐   ┌──────▼───────┐  │
│  │core/library │   │ core/lyrics  │   │ Canvas (rAF) │  │
│  └─────────────┘   └──────────────┘   └──────────────┘  │
│  ┌─────────────┐   ┌──────────────┐                     │
│  │features/skin│   │  state/*.ts  │  zustand stores     │
│  └─────────────┘   └──────────────┘                     │
└────────────────────────┬─────────────────────────────────┘
                         │ Tauri IPC（typed invoke）
              ┌──────────▼───────────┐
              │ Rust（src-tauri）     │
              │ · 目录扫描（walkdir） │
              │ · 元数据提取（lofty） │
              │ · 资产协议（音频流）  │
              │ · 托盘 / 全局快捷键   │
              │ · 播放列表持久化      │
              └──────────────────────┘
```

**职责边界**：Rust 不碰音频解码（MVP 阶段），只做文件系统、元数据、系统集成。音频解码、FFT、渲染全部在前端 Web Audio API。

### 2.1 技术选型复用审计（纪律一落地）

| 领域                    | 选型                                            | 复用/自研 | 依据                                                                                                      |
| ----------------------- | ----------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| 状态管理                | zustand                                         | ✅ 复用   | 轻量、TS 类型一流                                                                                         |
| 虚拟列表                | @tanstack/react-virtual                         | ✅ 复用   | 万首曲库刚需                                                                                              |
| 基础交互组件            | Radix UI primitives（无样式）+ lucide-react     | ✅ 复用   | 无样式原语完美兼容皮肤系统                                                                                |
| 元数据/目录扫描         | lofty + walkdir                                 | ✅ 复用   | Rust 生态标准件                                                                                           |
| 系统集成                | tauri-plugin-dialog / -store / -global-shortcut | ✅ 复用   | 官方插件                                                                                                  |
| 音频解码/FFT            | Web Audio API 平台能力                          | ✅ 复用   | 平台原生，不引入解码库                                                                                    |
| **节拍检测**            | **自研 `core/analysis/BeatDetector.ts`**        | ⚠️ 自研   | `web-audio-beat-detector` 等已停维护，不满足健康度门槛；且律动算法是产品核心差异化 → 允许自研，必须配单测 |
| **LRC 解析**            | **自研 `core/lyrics/lrcParser.ts`**             | ⚠️ 自研   | 现有 lrc 库普遍年久失修；解析器约百行且需逐字/容错定制 → 自研 + 全量单测                                  |
| **视觉渲染器/皮肤协议** | **自研 `core/visualizer` + `features/skins`**   | ⚠️ 自研   | 产品核心差异化，无健康现成库                                                                              |

> 规则：任何 ⚠️ 自研项都必须满足「复用三问」第 1 问为否、第 2 问为是，且进入 `src/core/` 配单测过 G2。选型变更需同步更新本表。

---

## 3. 工程目录结构

```
likey/
├─ AGENTS.md                    # 开发纪律 + 质量门（开发者与 AI 代理必读）
├─ docs/
│  └─ DESIGN.md                 # 本文档
├─ src/                         # React 前端（纯 TS）
│  ├─ core/                     # 核心逻辑，零 React 依赖
│  │  ├─ player/
│  │  │  ├─ PlayerCore.ts       # 播放内核 + 状态机
│  │  │  ├─ AudioGraph.ts       # Web Audio 节点图封装
│  │  │  └─ BufferCache.ts      # AudioBuffer LRU 缓存
│  │  ├─ analysis/
│  │  │  ├─ SpectrumExtractor.ts# 频谱帧提取 + 对数分桶
│  │  │  └─ BeatDetector.ts     # 低频 onset 节拍检测
│  │  ├─ visualizer/
│  │  │  ├─ types.ts            # Renderer 接口 + 参数协议
│  │  │  ├─ SpectrumBarRenderer.ts
│  │  │  └─ RenderLoop.ts       # 统一 rAF 循环
│  │  ├─ library/
│  │  │  ├─ types.ts            # Track / TrackMeta 契约
│  │  │  └─ scan.ts             # IPC 封装 + 归一化
│  │  ├─ lyrics/
│  │  │  ├─ lrcParser.ts        # LRC 解析（多时间标签=逐字）
│  │  │  └─ LyricsSync.ts       # 同步引擎（二分查找）
│  │  └─ utils/events.ts        # 轻量事件总线（类型安全）
│  ├─ features/                 # React 绑定层
│  │  ├─ player/                # hooks + 控制条组件
│  │  ├─ library/               # 列表视图（虚拟列表）
│  │  ├─ lyrics/                # 歌词面板
│  │  ├─ visualizer/            # VisualizerCanvas 组件
│  │  └─ skins/                 # 皮肤协议 + 主题注入
│  ├─ state/                    # zustand stores
│  │  ├─ playerStore.ts
│  │  ├─ libraryStore.ts
│  │  ├─ lyricsStore.ts
│  │  ├─ playlistStore.ts
│  │  └─ skinStore.ts
│  ├─ app/                      # App 壳、视图、布局
│  └─ styles/                   # CSS 变量与全局样式
├─ src-tauri/                   # Rust 后端
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ lib.rs
│  │  ├─ commands/
│  │  │  ├─ scan.rs             # 目录扫描
│  │  │  └─ metadata.rs         # lofty 元数据
│  │  └─ models.rs              # TrackMeta（serde）
│  ├─ capabilities/default.json # Tauri v2 权限声明
│  └─ tauri.conf.json
├─ index.html
├─ package.json                 # 含 gate/typecheck/lint/test 脚本
├─ eslint.config.js             # flat config，TS 推荐规则
├─ .prettierrc
├─ .husky/pre-commit            # lint-staged 快速门
├─ tsconfig.json                # strict: true, noUncheckedIndexedAccess: true
└─ vite.config.ts
```

---

## 4. 播放内核（core/player）

### 4.1 状态机（discriminated union，杜绝非法状态）

```ts
// core/player/PlayerCore.ts
export type PlayerStatus =
  | { readonly kind: 'idle' } // 无曲目
  | { readonly kind: 'loading'; readonly track: Track } // 解码中
  | { readonly kind: 'ready'; readonly track: Track; readonly paused: boolean } // 就绪/已暂停
  | { readonly kind: 'playing'; readonly track: Track } // 播放中
  | { readonly kind: 'error'; readonly track: Track; readonly error: PlayerError }

export type PlayerError =
  | { readonly code: 'decode-unsupported'; readonly format: string } // 格式不支持
  | { readonly code: 'decode-failed'; readonly message: string }
  | { readonly code: 'io-error'; readonly message: string }

export interface PlayerCore {
  readonly load: (track: Track) => Promise<void> // idle/ready/playing → loading → ready
  readonly play: () => Promise<void> // ready(paused) → playing
  readonly pause: () => void // playing → ready(paused)
  readonly stop: () => void // 任意 → idle
  readonly seek: (seconds: number) => void
  readonly setVolume: (v: number) => void // 0..1
  readonly getPosition: () => number // 秒，由 currentTime 推导
  readonly getDuration: () => number
  readonly getStatus: () => PlayerStatus
  readonly getAudioContext: () => AudioContext // 供分析器/渲染器接入

  // 事件订阅（返回退订函数）
  readonly onStatusChange: (cb: (s: PlayerStatus) => void) => () => void
  readonly onTimeUpdate: (cb: (pos: number) => void) => () => void
  readonly onTrackEnd: (cb: () => void) => () => void
}
```

### 4.2 音频图（AudioGraph）

```
AudioBufferSourceNode ──▶ AnalyserNode ──▶ GainNode ──▶ destination
        │                     │
   (one-shot 播放，        (fftSize=2048,
    pause 时 stop()，       smoothingTimeConstant=0.75，
    resume 时重建 Source)    Uint8Array 频率数据 @ rAF)
```

```ts
// core/player/AudioGraph.ts
export interface AudioGraph {
  readonly context: AudioContext
  readonly analyser: AnalyserNode
  /** 播放 buffer 从 offset 秒开始；返回结束回调的注册入口 */
  readonly start: (buffer: AudioBuffer, offsetSeconds: number) => void
  readonly stop: () => void // pause/stop 共用
  readonly setVolume: (v: number) => void
  readonly onEnded: (cb: () => void) => () => void
}
```

**时间基实现（单一时钟核心）**：

```ts
// 播放开始：startedAt = context.currentTime - startOffset
// 任意时刻位置：position = context.currentTime - startedAt
// pause：startOffset = context.currentTime - startedAt（冻结）
// resume：重建 SourceNode，start(0, startOffset)
```

> 注意：`AudioBufferSourceNode` 是 one-shot 的，`stop()` 后不能复用。pause/resume 必须走「stop 旧 Source + 按 offset 重建新 Source」的标准模式。seek 同理：直接 stop + 按新 offset 重建。

### 4.3 解码与缓存（BufferCache）

**策略：全量解码 + LRU 缓存**

- 一首 4 分钟 44.1kHz 立体声 16bit ≈ 42MB；LRU 容量 2，峰值 ≈ 84MB，可接受。
- `decodeAudioData` 解码在浏览器内部离主线程进行，不阻塞 UI。
- 命中缓存时 `load()` 零等待；未命中时状态为 `loading`，UI 显示加载态。

```ts
// core/player/BufferCache.ts
export interface BufferCache {
  /** 获取已解码 buffer；未命中返回 undefined */
  readonly get: (trackId: string) => AudioBuffer | undefined
  /** 缓存 buffer，触发 LRU 淘汰；返回被淘汰的 trackId（供日志） */
  readonly put: (trackId: string, buffer: AudioBuffer) => string | null
  readonly clear: () => void
  readonly size: () => number
}

export type BufferCacheFactory = (capacity: number) => BufferCache
```

**音频字节来源**：Tauri v2 资产协议。Rust 侧暴露 `convertFileSrc(path)`，前端 `fetch(url) → arrayBuffer → decodeAudioData`。大文件走协议流式传输，避免 IPC 整包拷贝。

### 4.4 解码失败降级链（格式兼容核心逻辑）

```ts
// core/player/decodePipeline.ts
export type DecodeSource =
  | { readonly kind: 'buffer'; readonly buffer: AudioBuffer } // 缓存命中
  | { readonly kind: 'decoded'; readonly buffer: ArrayBuffer } // 原生解码成功

export interface DecodeResult {
  readonly buffer: AudioBuffer
  /** 使用的解码器：native | wasm-flac | wasm-mp3 | ... */
  readonly decoder: DecoderKind
}

export type DecodePipeline = (bytes: ArrayBuffer, format: AudioFormat) => Promise<DecodeResult>
```

降级顺序：`AudioContext.decodeAudioData` 原生解码 → 失败则 WASM 解码器（`@wasm-audio-decoders/flac` 等，二期引入）→ 仍失败报 `decode-unsupported`。**Spike 已实测：macOS 26.5 WKWebView 三格式原生解码全部通过（`scripts/webview-decode-probe.swift`），WASM 兜底退出 MVP 范围**。

### 4.5 播放队列（QueueController，S1 引入）

```ts
// core/player/Queue.ts
export interface PlaylistTrack { readonly id; readonly name; readonly file }  // S3 起替换为路径型 Track
export interface TrackRef { readonly id; readonly name }                      // PlayerCore.load 契约（缓存 key）
export type RepeatMode = 'off' | 'all' | 'one'
export function createShuffleOrder(length, seed): readonly number[]  // mulberry32 确定性洗牌
export function advanceAuto(count, current, order, repeat): number | null   // 自动推进（尊重循环）
export function advanceManual / retreatManual                               // 手动切歌（无条件回绕）

// core/player/QueueController.ts
export interface QueuePlayer { load(track, data); play(); stop(); seek(); getStatus(); onTrackEnd() }
export class QueueController {
  getSnapshot(): QueueSnapshot   // { tracks, index, repeat, shuffle }
  addFiles(files, playFirst?) / playIndex(i) / next() / prev()
  setRepeat(mode) / toggleShuffle() / removeAt(i) / clear() / dispose()
  onQueueChange / onIndexChange / onRepeatChange / onShuffleChange / onQueueEnded
}
```

- 自动推进：订阅 `PlayerCore.trackEnd`；`repeat='one'` 重播当前曲（PlayerCore 自然结束后位置已归零）；`'off'` 到底触发 `queueEnded`；`'all'` 回绕
- 手动切歌无条件回绕（repeat 模式不影响手动操作，与主流播放器一致）
- 洗牌用带种子 PRNG（可复现、可单测）；`seedProvider` 可注入
- 竞态防护：`playIndex` 在文件读取 await 后校验 index 未变才继续加载
- 队列事件 → zustand store 镜像（§12），UI 不直接读控制器

---

## 5. 音频分析与律动（core/analysis）

### 5.1 频谱帧提取（SpectrumExtractor）

```ts
// core/analysis/SpectrumExtractor.ts
export interface SpectrumFrame {
  /** 对数分桶后的能量，长度 = barCount，0..1 归一化 */
  readonly bars: Float32Array
  /** 原始频域数据（分析用），长度 = analyser.frequencyBinCount */
  readonly raw: Uint8Array
  /** 低频能量（20–250Hz），节拍检测输入 */
  readonly lowEnergy: number
  /** 中频、高频能量（驱动背景氛围光晕色温） */
  readonly midEnergy: number
  readonly highEnergy: number
}

export interface SpectrumExtractor {
  /** 每个渲染帧调用一次；内部做对数分桶 + 三段能量统计 */
  readonly nextFrame: () => SpectrumFrame
  readonly setBarCount: (n: number) => void
  readonly dispose: () => void
}

export type SpectrumExtractorFactory = (
  analyser: AnalyserNode,
  opts: Readonly<{ minFreq: number; maxFreq: number; barCount: number }>,
) => SpectrumExtractor
```

**对数分桶算法**（听觉感知：低频条密度更高）：

```
bar b ∈ [0, B)：
  f1 = minFreq × (maxFreq / minFreq) ^ (b / B)
  f2 = minFreq × (maxFreq / minFreq) ^ ((b + 1) / B)
  binHz = sampleRate / fftSize
  能量[b] = mean( raw[ floor(f1/binHz) .. floor(f2/binHz) ] ) / 255
```

**三段频带**：low 20–250Hz（鼓/贝斯）· mid 250Hz–4kHz（人声/吉他）· high 4k–16k（镲片/气声）。

### 5.2 节拍检测（BeatDetector）

低频能量 onset 检测，自适应阈值，无需 BPM 先验：

```ts
// core/analysis/BeatDetector.ts
export interface BeatEvent {
  /** 节拍强度：当前能量 / 阈值，>1 必触发，值越大越「重」 */
  readonly strength: number
  /** 音频时钟时间戳（秒），与 currentTime 同域 */
  readonly time: number
}

export interface BeatDetectorOptions {
  readonly historyFrames: number // 滑动窗口帧数，默认 60（≈1s @60fps）
  readonly sensitivity: number // 阈值 σ 系数，默认 1.4（1.2–1.8 可调）
  readonly cooldownMs: number // 触发冷却，默认 250（覆盖 240BPM）
}

export interface BeatDetector {
  /** 每帧喂入低频能量；命中返回事件，否则 null */
  readonly update: (lowEnergy: number, time: number) => BeatEvent | null
  readonly reset: () => void
}

export type BeatDetectorFactory = (opts?: Partial<BeatDetectorOptions>) => BeatDetector
```

**算法伪代码**：

```
update(lowEnergy, time):
  mean, variance ← 最近 historyFrames 帧（不含当前帧）
  threshold = mean + sensitivity × √variance
  if lowEnergy > threshold and (time − lastBeatTime) > cooldown:
      emit BeatEvent(strength = lowEnergy / threshold, time)
      push min(lowEnergy, threshold) 到历史   # 防阈值自膨胀
  else:
      push lowEnergy 到历史
```

**平滑策略**（渲染层使用，与检测层分离）：

```
# 柱高：上升即时、下降指数衰减（视觉「弹性」的关键）
smoothed[b] = max(raw[b], smoothed[b] × 0.90)     # 0.90 = fallSpeed，皮肤可配

# 峰值保持线：记录历史峰值，未超越时缓慢下落
peak[b] = max(raw[b], peak[b] − peakDropPerFrame)
```

---

## 6. 可视化引擎（core/visualizer）

### 6.1 渲染器接口（可插拔，为未来粒子/波形模式留口）

```ts
// core/visualizer/types.ts
export interface VisualizerSource {
  /** 每帧拉取最新频谱帧 */
  readonly nextFrame: () => SpectrumFrame
  /** 节拍检测器（渲染器每帧轮询，或订阅事件流） */
  readonly beatDetector: BeatDetector
}

export interface VisualizerOptions {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

export interface VisualizerRenderer {
  readonly mount: (canvas: HTMLCanvasElement) => void
  readonly setSource: (src: VisualizerSource) => void
  readonly setOptions: (opts: Partial<VisualizerOptions>) => void
  readonly start: () => void // 加入统一 rAF 循环
  readonly stop: () => void
  readonly dispose: () => void
}

export type VisualizerRendererFactory = (kind: VisualizerKind) => VisualizerRenderer

export type VisualizerKind = 'spectrum-bars' | /* 二期 */ 'particles' | 'oscilloscope'
```

### 6.2 频谱柱渲染参数（皮肤协议直接映射此结构）

```ts
// core/visualizer/SpectrumStyle.ts（与皮肤 JSON 的 spectrumStyle 字段同构）
export interface SpectrumStyle {
  readonly barCount: number // 32 | 48 | 64
  readonly mirror: boolean // 四象限镜面对称（千千静听经典）
  readonly rounded: boolean // 圆角柱
  readonly gap: number // 条间距（px）
  readonly gradient: readonly [string, string] // [底色, 顶色]
  readonly peakHold: boolean // 峰值保持线开关
  readonly fallSpeed: number // 0.85–0.95，越大拖尾越长
  readonly beatPulse: boolean // beat 时整体脉冲
  readonly glow: boolean // 背景氛围光晕（色温随频段 + 节拍呼吸）
  readonly mode: 'bars' | 'liquid' | 'chunky' | 'green' | 'bands' | 'classic' // 视觉形态：频谱柱 / 液体剪影 / 加宽胶囊柱 / 深绿电平表 / 横向频谱带 / 经典原版
}
```

### 6.3 渲染循环（RenderLoop）

- 单一 `requestAnimationFrame` 循环，多渲染器复用同一循环（未来歌词卡拉OK 进度也挂同一循环）。
- 每帧：`nextFrame()` → 平滑 → 画柱 + 峰值线 → 轮询 `beatDetector` → 若 hit 则注入脉冲（scale 1.0→1.06→回弹）。
- 四象限镜像（低频居中排列）：Q1/Q2（上）与 Q3/Q4（下）平移互换——低音柱在中心相会形成山峰，高频向两侧展开；上半全主渐变，下半为完全倒影：中心线 50% 混合色 @45% 透明度，向下渐隐至 6% 并镜像回底色（`color.ts mixWithAlpha`/`hexWithAlpha`），无硬切割。
- 六种视觉形态（`mode`，运行时偏好，`visualizerModeStore` 驱动，可随时切换）：`bars` 频谱柱 + 峰值线；`liquid` 液体剪影——无缝弧面（每段半圆弧首尾相接）上下各一条，填充同一渐变，表面另描一圈高光边（顶面 0.4 白 / 倒影面 0.22 白），液体模式不画峰值线；`chunky` 加宽柱——柱数减半（相邻两根取 max 合并）、柱宽 ≈ 槽宽、顶部全圆角成胶囊状，保留峰值线；`green` 深绿电平表——单排加宽**纯矩形**柱、纯净深翠绿（`#0b6e4f`）纯色填充，强制无镜像、无倒影、无圆角（忽略 mirror/rounded），保留峰值线；`bands` 横向频谱带（千千静听原版）——每个频段一条横向长条上下堆叠（低频在下、高频在上），自左向右伸缩，单排无镜像/倒影/峰值线；`classic` 经典原版（正弦构图）——只填 Q2/Q4 两象限、Q1/Q3 留空，低频在左右外缘、高频在中线，整体呈正弦函数形状，强制忽略 mirror。
- **幅度系数**：柱高/液面/峰值线/横向带宽统一乘 `AMPLITUDE_SCALE`（0.85）——盒子尺寸不变，律动整体等比缩放 15%，给高频峰值留出余量：能量 1.0 叠满节拍脉冲 1.05 也只到 89%，不会超出面板边缘；比例与律动逻辑不变（峰值线同步缩放保持对齐）。
- 背景氛围光晕：`ambient.ts computeGlow` 依据三段能量算色温（低频暖/高频冷，指数平滑）与透明度（含节拍呼吸），中心径向渐变铺底。
- Canvas 尺寸按 `dpr` 缩放，`getBoundingClientRect` 变化时重设。
- **性能预算：单帧渲染 ≤ 8ms，空闲时 CPU < 3%，播放时 < 5%**。Canvas 2D 画 48–64 根柱 + 峰值线 + 光晕远低于此预算，无 WebGL 必要。

---

## 7. 音乐库（Rust + core/library）

### 7.1 Rust 侧命令（src-tauri）

```rust
// src-tauri/src/models.rs
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMeta {
    pub path: String,            // 规范化绝对路径（也作为 id 输入）
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    pub format: String,          // "mp3" | "flac" | "wav"
    pub has_cover: bool,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

// src-tauri/src/commands/scan.rs
#[tauri::command]
pub fn scan_directory(path: String, recursive: bool) -> Result<Vec<TrackMeta>, String>;

// src-tauri/src/commands/metadata.rs
#[tauri::command]
pub fn read_metadata(path: String) -> Result<TrackMeta, String>;

#[tauri::command]
pub fn read_cover(path: String) -> Result<Vec<u8>, String>;  // 内嵌封面字节，前端转 Blob URL
```

- 扫描用 `walkdir`（去重、按扩展名过滤、并发提取元数据用 `lofty`）。
- 目录授权：用户通过 `tauri-plugin-dialog` 选择目录，获得持久访问权限；capabilities 里声明 `fs` 与 `dialog` 最小权限。
- 大目录扫描放后台线程 + 进度事件（`tauri::ipc::Channel` 或 event），前端显示扫描进度。

### 7.2 前端契约（core/library/types.ts）

```ts
// core/library/types.ts
export type AudioFormat = 'mp3' | 'flac' | 'wav'

export interface Track {
  /** id = 规范化路径的稳定哈希（如 FNV-1a 的 hex），跨会话稳定 */
  readonly id: string
  readonly path: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number // 秒
  readonly format: AudioFormat
  readonly hasCover: boolean
  readonly coverUrl?: string // 懒加载：首次可见时经 read_cover 生成 Blob URL
  readonly fileUrl: string // convertFileSrc(path)，音频字节入口
}

export type LibraryScanState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'scanning'; readonly done: number; readonly total: number }
  | { readonly kind: 'done'; readonly added: number; readonly failed: number }
  | { readonly kind: 'error'; readonly message: string }
```

- 播放列表持久化用 `tauri-plugin-store`（JSON 文件），存 `trackId` 数组 + 顺序 + 随机种子。
- 列表 UI 用虚拟列表（`@tanstack/react-virtual`），万首规模无压力。

---

## 8. 歌词系统（core/lyrics）

### 8.1 LRC 解析（支持多时间标签 = 逐字）

```ts
// core/lyrics/lrcParser.ts
export interface LyricToken {
  readonly time: number // ms
  readonly text: string
}

export interface LyricLine {
  readonly start: number // 行起始时间 ms
  readonly tokens: readonly LyricToken[] // 长度 1 = 整行；>1 = 逐字
  readonly text: string // 整行文本（拼接）
}

export interface LrcDocument {
  readonly lines: readonly LyricLine[] // 按时间升序
  readonly metadata: Readonly<Record<string, string>> // ti/ar/al/by/offset
  readonly offsetMs: number // 文件内 [offset:+500]
}

export type ParseLrc = (raw: string) => Result<LrcDocument, LrcParseError>
```

格式要点：

- 标准标签：`[ti:][ar:][al:][by:][offset:±ms]`
- 单时间标签 → 整行歌词；**多个时间标签 → 逐字节奏**（标准 LRC 特性，无需私有扩展）
- 同时间多行 → 翻译行（保留 `kind: 'translation'` 标记，二期做双语展示）

### 8.2 同步引擎（LyricsSync）

```ts
// core/lyrics/LyricsSync.ts
export interface LyricsSync {
  /** 每次播放器时间更新调用；返回当前行索引变化时触发回调 */
  readonly update: (positionMs: number) => void
  readonly setOffset: (ms: number) => void // 用户校准 ±500ms，步进 50ms
  readonly onActiveLine: (cb: (index: number | null) => void) => () => void
  readonly onTokenProgress: (
    cb: (lineIndex: number, tokenIndex: number, progress: number) => void,
  ) => () => void
  readonly reset: () => void
}
```

- 当前行定位：**按 `start` 升序二分查找**，O(log n)。
- 逐字进度：行内 token 时间线性插值，输出 `progress 0..1` 驱动卡拉OK 渐变宽度。
- 偏移校准值持久化到 `tauri-plugin-store`（per trackId），下次播放自动生效。

### 8.3 卡拉OK 双行渲染

- 双行布局：上一行（渐暗）→ 当前行（放大、渐亮）→ 下一行。
- 当前行渐变：**两层叠字** —— 底层灰色全文，顶层高亮色 `clip-path: inset(0 (100%−p) 0 0)`，p 由 `onTokenProgress` 每帧驱动（挂统一 rAF，不依赖 CSS transition，避免 pause/seek 漂移）。
- 自动滚动：当前行索引变化时，容器 `scrollTo` 行居中。

---

## 9. 皮肤系统（features/skins）

### 9.1 皮肤协议（JSON Schema 的核心，TS 类型即契约）

```ts
// features/skins/types.ts
export interface Skin {
  readonly id: string
  readonly name: string
  readonly version: 1
  readonly colors: {
    readonly appBg: string // 应用背景
    readonly panelBg: string // 面板背景
    readonly textPrimary: string
    readonly textSecondary: string
    readonly accent: string // 强调色（按钮/高亮）
    readonly spectrum: readonly [string, string] // 频谱渐变
    readonly lyricActive: string // 当前歌词行
    readonly lyricProgress: string // 卡拉OK 渐变色
    readonly lyricInactive: string
  }
  readonly spectrumStyle: SpectrumStyle // 与 §6.2 同构，直接注入渲染器；glow 缺省为 true
  readonly lyrics: {
    readonly fontSize: number
    readonly lineHeight: number
  }
}

export type SkinRegistry = {
  readonly skins: readonly Skin[]
  readonly activeId: string
  readonly loadUserSkin: (json: string) => Result<Skin, SkinParseError>
  readonly activate: (id: string) => void
}
```

### 9.2 应用机制

- 颜色 → 注入 `document.documentElement.style` 的 CSS 自定义属性（`--app-bg` 等），全局样式只用变量。
- `spectrum` 字段 → `SpectrumBarRenderer.setOptions()`。
- 内置 3 套：`classic`（千千静听风）、`dark-cyan`（现代深色）、`paper`（浅色）；皮肤文件 JSON 可放用户目录加载。

---

## 10. 桌面集成（src-tauri）

| 能力              | 方案                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| 系统托盘          | Tauri v2 内置 tray：播放/暂停/上一曲/下一曲/退出；支持**迷你模式**（窗口缩为悬浮条，只显示频谱+控制） |
| 全局快捷键/媒体键 | `tauri-plugin-global-shortcut`；macOS 需辅助功能权限，降级路径 = 系统媒体键（Now Playing）            |
| 媒体会话          | WebView 内 `navigator.mediaSession`：设置 metadata + 播放/暂停/上下曲 handler，系统级媒体控制         |
| 拖放/文件关联     | WebView 拖放事件 + Tauri 文件关联（`.mp3/.flac/.wav` → 应用打开即入队）                               |
| 播放列表持久化    | `tauri-plugin-store`                                                                                  |
| 自动更新          | 二期（`tauri-plugin-updater`）                                                                        |

**macOS 权限注意**：目录扫描需用户通过系统对话框授权；`capabilities/default.json` 按最小权限声明（`fs:scope` 仅用户选中目录、`global-shortcut` 显式注册键位）。

---

## 11. IPC 接口清单

| 命令             | 签名（Rust → TS invoke）          | 说明                     |
| ---------------- | --------------------------------- | ------------------------ |
| `scan_directory` | `(path, recursive) → TrackMeta[]` | 后台扫描 + 进度事件      |
| `read_metadata`  | `(path) → TrackMeta`              | 单曲刷新元数据           |
| `read_cover`     | `(path) → Uint8Array`             | 内嵌封面                 |
| `convertFileSrc` | `(path) → string`                 | 音频字节 URL（资产协议） |
| `pick_directory` | `() → string \| null`             | dialog 插件，目录授权    |
| 播放列表         | store 插件（前端直读）            | 无自定义命令             |

前端统一封装在 `core/library/scan.ts` 与 `features/player/tauriBridge.ts`，所有 invoke 带 `Result` 处理与错误 toast。

---

## 12. 状态管理（zustand）

```ts
// state/queueStore.ts（S1 已实现）
interface QueueStoreState {
  readonly tracks: readonly PlaylistTrack[]
  readonly index: number
  readonly repeat: RepeatMode
  readonly shuffle: boolean
  bind(player: QueuePlayer): void
  addFiles(...) / playIndex(...) / next() / prev() / removeAt(...) / clear()
  setRepeat(...) / toggleShuffle()
}
```

- `QueueController` 是队列唯一事实来源（纯 TS 可单测），zustand store 仅镜像快照供 React 渲染
- 播放器 `status/position` 当前由 `usePlayerEngine` 以 React 状态承载（4Hz 刷新）；后续里程碑若需跨组件共享再迁移至 playerStore

关键点：**高频数据（频谱帧、节拍事件、逐字进度）不进 store**，由核心模块事件直达渲染器/歌词组件，store 只承载低频 UI 状态（避免每秒数千次 React 重渲染）。

---

## 13. 性能预算

| 指标         | 预算                                        |
| ------------ | ------------------------------------------- |
| 渲染帧耗时   | ≤ 8ms（Canvas 2D，48 柱 + 峰值线）          |
| CPU 占用     | 空闲 < 3%，播放 < 5%                        |
| 内存         | AudioBuffer LRU(2) ≈ 84MB 上限，常规 < 60MB |
| 冷启动到出声 | 本地 mp3 < 1s                               |
| 万首曲库滚动 | 虚拟列表，交互不卡顿                        |

---

## 14. 格式兼容与降级策略

| 格式     | Windows(WebView2) | macOS(WKWebView)                                                         | 降级                                 |
| -------- | ----------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| mp3      | ✅ 原生           | ✅ **实测通过**（`scripts/webview-decode-probe.swift`，1.045s 解码成功） | —                                    |
| wav      | ✅ 原生           | ✅ **实测通过**                                                          | —                                    |
| flac     | ✅ 原生           | ✅ **实测通过**（风险解除，WASM 兜底退出 MVP 范围）                      | 无需（二期仍可备 WASM 兜底）         |
| m4a      | ✅ 原生           | ✅ **实测通过**（1.000s，MP4/AAC 容器；lofty mp4 模块读标签）            | —                                    |
| aac      | ✅ 原生           | ✅ **实测通过**（1.045s，ADTS 裸流；lofty aac 模块读时长）               | —（裸流无标签，标题取文件名）        |
| ogg/opus | ✅ 原生           | ❌ Safari 系不支持 Ogg                                                   | 不加入（二期可备 WASM 兜底）         |
| mp4      | ✅（音频流）      | ✅（音频流）                                                             | 不加入扫描白名单（避免误扫视频文件） |

解码失败统一走 §4.4 降级链，最终兜底为 `decode-unsupported` 错误态 + UI 提示（提示音轨不可播，不崩溃不卡死）。

---

## 15. 风险清单

| 风险                           | 影响                   | 缓解                                                                                               |
| ------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------- |
| ~~WKWebView 不支持 flac 解码~~ | ~~macOS 上 flac 全灭~~ | ✅ **已解除**：macOS 26.5 WKWebView 实测三格式解码全部通过（`scripts/webview-decode-probe.swift`） |
| 全量解码内存峰值               | 低配机卡顿             | LRU(2) + 解码前检查 `navigator.deviceMemory` 动态降容量                                            |
| macOS 目录扫描权限             | 无法读库               | dialog 授权流程 + 错误提示指引                                                                     |
| 全局快捷键需要辅助功能权限     | 热键不可用             | 系统媒体键降级路径（MediaSession）                                                                 |
| `AudioContext` 被系统策略暂停  | 后台无声               | 监听 `statechange`，恢复时自动重建 Source                                                          |
| 多时间标签 LRC 兼容乱          | 歌词错乱               | 解析器容错：非法行跳过并计数，UI 提示「歌词解析失败 N 行」                                         |

---

## 16. 测试策略

- **Vitest 单测（core 层，纯函数优先，覆盖率 ≥ 80% 为质量门 G2 硬指标）**：
  - `lrcParser`：标准标签、多时间标签逐字、offset、非法行容错
  - `BeatDetector`：合成 120BPM 点击音轨信号 → 期望 ~2Hz 节拍事件、冷却生效、阈值自适应不漂移
  - 对数分桶数学：边界频率、桶数变化
  - `BufferCache`：LRU 淘汰顺序
  - 皮肤 JSON 校验：合法/缺字段/类型错误
- **Spike 手工清单（S0）**：macOS 与 Windows 各跑一遍：mp3/flac/wav 播放、seek 精度、频谱 60fps、节拍触发肉眼可感、歌词同步。
- E2E 暂不引入（桌面 WebView 测试链成本高，二期用 Playwright + tauri-driver）。

---

## 17. 里程碑与验收标准

| 阶段                | 内容                                                                              | 验收标准                                         | 实现状态                                      |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| **S0** 脚手架+Spike | Tauri+React+Vite+TS(strict) 跑通；播放 mp3/flac/wav；AnalyserNode → Canvas 频谱条 | macOS/Windows 双平台频谱随音乐律动               | ✅ 已实现（G4 待实机）                        |
| **S1** 播放内核     | 状态机、seek/pause/resume、音量、队列、循环/随机                                  | 连续播放 20 首无卡顿、无内存泄漏（内存曲线平稳） | ✅ 已实现（G4 待实机）                        |
| **S2** 律动可视化   | 平滑频谱 + 峰值线 + 镜面对称 + beat 脉冲                                          | 鼓点视觉可感；CPU < 5%                           | ✅ 已实现（G4 待实机）                        |
| **S3** 音乐库       | 目录扫描、元数据、封面、虚拟列表、播放列表持久化                                  | 万首曲库流畅滚动，重启后列表还原                 | ✅ 已实现（G4 待实机）                        |
| **S4** 歌词         | LRC 解析、同步、逐字、卡拉OK 双行、偏移校准                                       | 人声对齐 ±50ms；偏移设置持久化                   | ✅ 已实现（G4 待实机）                        |
| **S5** 皮肤         | 皮肤协议 + 3 套内置主题 + 用户皮肤加载                                            | 热切换即时生效，非法皮肤报错不崩                 | ✅ 已实现（G4 待实机）                        |
| **S6** 桌面集成     | 托盘、全局快捷键、媒体会话、文件关联、打包（dmg/msi）                             | 双平台安装包可用，媒体键可控播放                 | ✅ 代码完成（打包构建验证中；文件关联留二期） |

---

## 18. 二期展望（不在 MVP）

- 粒子宇宙 / 示波器波形 / 放射频谱等更多视觉模式（渲染器接口已预留）
- 波形预渲染 + 拖动 seek 预览
- 自动更新、在线皮肤市场
- 歌词自动下载（第三方源，需评估版权）

---

## 19. .js 音源接入（S7，已实现）

**协议**：lx-music 自定义音源兼容 —— 脚本定义全局 `window.source = { search(keyword, page, limit), getMusicUrl(songmid, quality), getLyric(songmid) }`，现有生态音源脚本可直接导入。

**架构**：

```
用户 .js 脚本 → sandbox iframe（allow-scripts，blob origin，无网络特权）
   ├─ 脚本内 fetch ──postMessage──▶ 主线程 SourceRuntime ──▶ tauri-plugin-http（reqwest，免 CORS）──▶ 响应 ArrayBuffer 回传（transferable）
   └─ RPC 调用（search/getMusicUrl/getLyric，30s 超时）──▶ 结果经协议校验（core/onlinesource/protocol.ts）──▶ UI / 播放队列
```

- 播放：`getMusicUrl` 返回远程 URL → 队列 `TrackSource.url` → `QueueController.readSource` 走插件 HTTP 原生取字节（免 CORS）→ 现有 PlayerCore 解码链与 LRU 缓存全部复用
- 歌词：`getLyric` 返回 LRC 文本 → `lyricOverrideStore` 注入歌词面板（优先于同名 .lrc 匹配）
- 内置音源（`public/sources/`，运行时经资产协议加载）：
  - **`youtube`（原生源，不经沙箱运行时）**：Rust 调 **yt-dlp sidecar**（`ytdl_search`/`ytdl_url` 命令）——把 YouTube 适配外包给维护最勤的开源 CLI，全曲库、无账号、零封号风险；取流强制 `bestaudio[ext=m4a]`（WKWebView 不支持 Opus/WebM，AAC 实测 206 audio/mp4）；yt-dlp 缺失时给出友好安装提示；标题启发式拆分「艺术家 - 曲名」（MV/Official/歌词版等标记不拆）
  - **YouTube 反爬（bot 检测）**：无 Cookie 请求可能被拦（"Sign in to confirm you're not a bot"）。音源面板可选「Cookie 来源」（Safari/Chrome/…，持久化），Rust 侧白名单校验后注入 `--cookies-from-browser <browser>`；命中 bot 错误且未配 Cookie 时错误信息自动追加操作指引。注意：Safari Cookie 需在 macOS 系统设置中授予 Likey「完全磁盘访问权限」，Chrome 读取会触发钥匙串授权。
  - `audius.js`：Audius 公开 API（免费开源音乐平台，无需密钥）——真实在线曲目全曲播放；流媒体 CDN 校验 User-Agent，经脚本 headers 透传（reqwest 无浏览器 header 限制）
  - `itunes.js`：iTunes Search API 试听源——主流曲库 30s 片段（平台限制）
  - `example.js`：本地音乐库示例源（离线验证全链路）
  - 真实可用性验证：curl 端到端 + WKWebView 探测 10/10（含 Audius 真实网络往返）；yt-dlp 搜索/取流实测（206 Partial Content）
  - **免费匿名高质源调研结论（2026-08 实测）**：酷我签名校验、咪咕 PE 加密、YouTube innertube SABR+po_token 挑战——直接逆向维护不可持续，故 YouTube 走 yt-dlp 托管适配
  - **Internet Archive 弃用结论**（三种路径实测 401：无 UA / 浏览器 UA / 匿名 cookie 会话）：下载端点要求登录会话，reqwest 无 cookie 持久化，不适合免密钥直链源 → 由 iTunes 试听源替代（覆盖主流曲库 30s 片段）
  - **HTTP 插件 scope 必须显式配置**（capabilities: `http:default` + `allow: ["https://*", "http://*"]`）：默认权限允许 fetch 操作但拒绝一切源，漏配表现为「搜索无结果/取流失败」——已修复并有插件单测背书（`http://*` 匹配任意主机任意路径）
- 用户音源脚本持久化到 `tauri-plugin-store`
- 安全边界：脚本无 DOM 网络特权（fetch 全部代理）、调用带超时、结果强校验、脚本崩溃不影响宿主

### 19.1 音源下载（离线缓存）

- Rust `download_file`：reqwest(rustls) 流式下载到 **`~/Music/Mymusic`**（用户可见目录），进度经 Channel 推送，文件已存在即复用；旧应用数据目录文件自动搬迁
- 命名规范：**`作者 - 歌名`**（作者缺失仅歌名）；Rust 侧安全清洗（保留中文/字母数字/空格，路径字符转义）+ 扩展名推断（Content-Type → URL 路径 → mp3 兜底）；`delete_download` 校验路径必须位于下载目录内
- **双轨元数据（方案 C）**：文件内写标准标签（标题/艺术家/专辑/**封面嵌入**/**歌词帧**，lofty 写入，集成测试验证）+ 旁路档案存完整溯源（sourceId/songmid/quality/album/duration/artworkPath/lyrics，plugin-store 持久化，旧记录字段可选自然兼容）
- 封面同时落盘 `covers/{名}.jpg`（旁路档案引用 + 下载列表缩略图）；歌词在下载时一并抓取（音源不提供不阻断）
- 曲库融合：扫描到的下载文件命中档案时，歌词面板优先使用档案歌词（旁路优先于同名 .lrc）
- 下载列表持久化（plugin-store）；离线播放走资产协议（`convertFileSrc`，scope 含 `$HOME/**`），与在线播放共用解码链
- 旧记录路径迁移：前端 restore 时经 `fixLegacyDownloadPath` 修复到新目录

---

_本文档为讨论稿，Spike（S0）结果（尤其 WKWebView 解码能力）将回填 §14 并可能调整 §4.4 的降级链范围。_
