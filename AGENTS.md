# AGENTS.md — 项目开发纪律

> 对在本仓库工作的所有开发者与 AI 代理生效。改动前先读本文档与 `docs/DESIGN.md`。

## 项目

**Likey**：千千静听（TTPlayer）风格律动音乐播放器。
技术栈：Tauri 2 + React 18 + Vite + **TypeScript（strict）** + Rust。
设计文档：`docs/DESIGN.md`（架构、接口契约、里程碑验收标准 §17）。

## 铁律

1. **全项目 TypeScript**，禁止新增 `.js`/`.jsx` 源文件。
2. **复用优先，禁止重复造轮子**：任何新依赖/自研决策必须过「复用三问」。
3. **质量门**：每次开发改动结束时必须跑 `pnpm gate` 全绿才算完成，缺一不可。

## 复用三问（用库还是自研的决策规则）

1. 有没有健康开源库：活跃维护 + TypeScript 类型 + 宽松许可（MIT/Apache）？
2. 是不是产品核心差异化（律动算法 / 皮肤协议 / 视觉渲染器）？
3. 引入成本是否明显低于自研成本？

→ 仅当问题 1 为「否」**且**问题 2 为「是」时，才允许自研：

- 自研模块必须进入 `src/core/`；
- 必须配套 Vitest 单测；
- 其余情况一律复用现成库。

技术选型审计表见 `docs/DESIGN.md` §2.1，选型变更需同步更新该表。

## 质量门（每次改动后执行，全绿才算完成）

| 门      | 内容                                                 | 命令                                                                                                                                                                                      |
| ------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 静态 | 类型 + 风格零错误                                    | `pnpm typecheck`（tsc -b, strict + noUncheckedIndexedAccess）+ `pnpm lint`（oxlint）+ `pnpm format:check`（prettier）；涉及 Rust 另加 `cargo clippy -- -D warnings` + `cargo fmt --check` |
| G2 测试 | 单测全过，`src/core` 覆盖率 ≥ 80%                    | `pnpm test`（Vitest + coverage）                                                                                                                                                          |
| G3 构建 | 产物可构建                                           | `pnpm build`；涉及 Rust 另加 `cargo check`；里程碑节点跑 `pnpm tauri build`                                                                                                               |
| G4 验收 | 对照 `docs/DESIGN.md` §17 当前里程碑验收标准逐条勾验 | 手工 / Spike 清单                                                                                                                                                                         |

- 一键执行 G1–G3：`pnpm gate`
- 提交前 husky + lint-staged 自动跑改动文件的快速门（格式 + lint），快速门失败会阻止提交。

## 变更流程

1. 改动前：读 `docs/DESIGN.md` 相关章节，确认接口契约与当前里程碑。
2. 实现：TypeScript strict；新依赖过「复用三问」。
3. 验证：`pnpm gate` 全绿（含新增模块单测，覆盖率达标）。
4. 文档：接口/架构/选型有变化时，同步更新 `docs/DESIGN.md`。
5. 汇报：说明改动文件、质量门结果、验收标准勾验情况。

## 常用命令

```bash
pnpm dev           # Vite 开发（纯 Web 调试）
pnpm tauri dev     # Tauri 桌面开发
pnpm gate          # G1+G2+G3 质量门
pnpm test          # Vitest 单测
pnpm tauri build   # 发布构建（里程碑节点）
node scripts/generate-source-probe-html.mjs   # 生成音源运行时探测页（真实源码零漂移）
swift scripts/webview-source-probe.swift      # 系统 WKWebView 验证音源运行时契约（10/10 项）
sh scripts/clean-build-cache.sh               # 清 debug 构建缓存（target/debug 会膨胀到数 GB）
```

> `.devrc` 仅供受限沙箱代理使用（重定向缓存到仓库内）；普通开发者终端请勿 source，
> 否则包管理缓存会堆进项目目录。

## 已知技术风险（开发中随时留意）

- ~~macOS WKWebView 对 flac 的 `decodeAudioData` 支持版本相关~~ → ✅ 已实测通过（macOS 26.5，`scripts/webview-decode-probe.swift`），WASM 兜底退出 MVP。
- 一切计时以 `AudioContext.currentTime` 为唯一时钟，禁止 `setTimeout`/`Date.now()` 驱动播放相关逻辑。
