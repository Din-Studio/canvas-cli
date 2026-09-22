#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill="$root/skills/scenemint-canvas/SKILL.md"

[[ -f "$skill" ]] || { echo "missing skills/scenemint-canvas/SKILL.md" >&2; exit 1; }
grep -Fq 'name: scenemint-canvas' "$skill"
grep -Fq 'connectionCode' "$skill"
grep -Fq 'references/commands.md' "$skill"
# SKILL.md 必须随发布归档一同分发。发布资产来自 npm pack，
# 契约的检查对象是 package.json 的 files 与打包测试 test/pack.test.mjs。
grep -Fq '"skills/"' "$root/package.json"
grep -Fq 'skills/scenemint-canvas/SKILL.md' "$root/test/pack.test.mjs"
# 安装脚本必须引用发布资产与仓库，发版后安装路径不能断。
grep -Fq 'Din-Studio/canvas-cli' "$root/scripts/install.sh"
grep -Fq 'Din-Studio/canvas-cli' "$root/scripts/install.ps1"
grep -Fq 'scenemint-canvas.tar.gz' "$root/scripts/install.sh"
grep -Fq 'scenemint-canvas.tar.gz' "$root/scripts/install.ps1"
echo "skill package contract passed"
