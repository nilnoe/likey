#!/bin/sh
# Likey 构建缓存清理脚本。
# 默认（safe）：清理可零成本再生的缓存（Rust debug 构建产物 + 临时缓存），
# 保留 release 产物（dmg/.app）与依赖缓存，下次构建需重编译（约 1–2 分钟）。
# 用法：sh scripts/clean-build-cache.sh [--aggressive]
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

safe() {
  echo "清理 Rust debug 构建缓存 (target/debug)..."
  rm -rf src-tauri/target/debug
  echo "清理临时缓存 (.xdg-cache .swift-cache .swift-tmp .probe .swift-probe)..."
  rm -rf .xdg-cache .swift-cache .swift-tmp .probe .swift-probe
}

aggressive() {
  echo "⚠️  激进清理：连依赖缓存一起删（下次构建需重新下载/安装全部依赖）"
  echo "清理 .cargo-home（crates 仓库缓存，~230MB，需重新下载）..."
  rm -rf .cargo-home
  echo "清理 .pnpm-store 与 node_modules（需 pnpm install 重装）..."
  rm -rf .pnpm-store node_modules
  echo "清理 .xdg-state..."
  rm -rf .xdg-state
}

if [ "$1" = "--aggressive" ]; then
  safe
  aggressive
else
  safe
fi

echo "完成。当前占用："
du -sh . 2>/dev/null | cut -f1
