#!/usr/bin/env bash
# scenemint-canvas 引导安装器
#
#   curl -fsSL https://github.com/Din-Studio/canvas-cli/releases/latest/download/install.sh | bash
#
# 唯一职责：取得一个校验通过的 scenemint-canvas 并写入 PATH。此后的更新请重跑本命令。
# 环境变量：CANVAS_VERSION 锁版本、CANVAS_MIRROR 自定义镜像、CANVAS_HOME 安装前缀。
set -euo pipefail

REPO="Din-Studio/canvas-cli"
DIRECT="https://github.com"
ASSET="scenemint-canvas.tar.gz"
CANVAS_HOME="${CANVAS_HOME:-$HOME/.local}"
PKG_DIR="$CANVAS_HOME/lib/scenemint-canvas"
BIN_DIR="$CANVAS_HOME/bin"
BIN_LINK="$BIN_DIR/scenemint-canvas"

say()  { printf 'scenemint-canvas-installer: %s\n' "$*"; }
fail() { printf 'scenemint-canvas-installer: %s\n' "$*" >&2; exit 1; }

# 候选源基址，直连优先。
sources() {
  echo "$DIRECT"
  [ -n "${CANVAS_MIRROR:-}" ] && echo "${CANVAS_MIRROR%/}/$DIRECT"
  echo "https://ghfast.top/$DIRECT"
  echo "https://gh-proxy.com/$DIRECT"
}

# 资产名不含版本号：latest/download/X 只是到 download/<最新tag>/X 的重定向，
# 因此无需先发现版本号即可下载。
asset_url() {
  local base="$1" asset="$2"
  if [ -n "${CANVAS_VERSION:-}" ]; then
    echo "${base}/${REPO}/releases/download/v${CANVAS_VERSION#v}/${asset}"
  else
    echo "${base}/${REPO}/releases/latest/download/${asset}"
  fi
}

# --speed-limit/--speed-time 只在真正停滞时放弃，取代会把大文件硬砍断的
# --max-time；-C - 让重试从断点续传而不是从头再来。
get() {
  curl -fsSL --connect-timeout 15 --retry 3 --retry-delay 1 --retry-all-errors \
       --speed-limit 1024 --speed-time 30 -C - "$1" -o "$2"
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else fail "需要 shasum 或 sha256sum"; fi
}

# 本包是纯 ESM、零依赖，但运行时需要 Node.js 22+。
check_node() {
  command -v node >/dev/null 2>&1 || fail "需要 Node.js 22 或更高版本（https://nodejs.org/）"
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null \
    || fail "需要 Node.js 22 或更高版本，当前: $(node --version)"
}

command -v curl >/dev/null 2>&1 || fail "需要 curl"
command -v tar  >/dev/null 2>&1 || fail "需要 tar"
check_node

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# checksums.txt 只有几百字节，慢链路上也容易直连成功。先只向直连索取：
# 校验和一旦来自可信源，归档包就可以安全地走镜像——镜像换不掉包。
# 每次换源前必须清掉残片：get 带 -C - 断点续传，若上一个来源传了一半就断，
# 换源后会把新来源的后半段追加到旧残片上，拼出一个损坏的校验和文件。
TRUSTED=1
rm -f "${TMP:?}/checksums.txt"
if ! get "$(asset_url "$DIRECT" checksums.txt)" "$TMP/checksums.txt" 2>/dev/null; then
  TRUSTED=0
  while IFS= read -r base; do
    [ "$base" = "$DIRECT" ] && continue
    rm -f "${TMP:?}/checksums.txt"
    get "$(asset_url "$base" checksums.txt)" "$TMP/checksums.txt" 2>/dev/null && break
  done < <(sources)
fi
[ -s "$TMP/checksums.txt" ] || fail "无法获取校验和文件，已中止以免安装未经校验的归档"

EXPECTED="$(awk -v a="$ASSET" '{sub(/^\*/,"",$2); if ($2==a) print tolower($1)}' "$TMP/checksums.txt")"
echo "$EXPECTED" | grep -qEx '[0-9a-f]{64}' || fail "校验和文件中没有 $ASSET"

say "版本 ${CANVAS_VERSION:-latest}"
DOWNLOADED=0
while IFS= read -r base; do
  say "下载 ${ASSET}（${base}）"
  rm -f "${TMP:?}/$ASSET"
  if get "$(asset_url "$base" "$ASSET")" "$TMP/$ASSET" 2>/dev/null; then DOWNLOADED=1; break; fi
  say "该来源不可用，尝试下一个"
done < <(sources)
[ "$DOWNLOADED" = 1 ] || fail "所有下载来源均失败"

[ "$(sha256_of "$TMP/$ASSET")" = "$EXPECTED" ] || fail "SHA-256 校验和不匹配，已中止"
say "SHA-256 校验通过"
[ "$TRUSTED" = 1 ] || say "警告 —— 校验和取自镜像而非 GitHub 直连，只能防传输损坏，不能防篡改"

rm -rf "${TMP}/pkg"
mkdir -p "$TMP/pkg"
# npm pack 的归档根目录是 package/；剥掉这一层再落位。
tar -xzf "$TMP/$ASSET" -C "$TMP/pkg" --strip-components=1
[ -f "$TMP/pkg/bin/scenemint-canvas.mjs" ] || fail "归档中缺少 bin/scenemint-canvas.mjs"

mkdir -p "$CANVAS_HOME/lib" "$BIN_DIR"
rm -rf "${PKG_DIR:?}.old"
[ -e "$PKG_DIR" ] && mv "$PKG_DIR" "$PKG_DIR.old"
mv "$TMP/pkg" "$PKG_DIR"
rm -rf "${PKG_DIR:?}.old"

ln -sfn "../lib/scenemint-canvas/bin/scenemint-canvas.mjs" "$BIN_LINK"
chmod 0755 "$PKG_DIR/bin/scenemint-canvas.mjs"
if [ "$(uname -s)" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$PKG_DIR/bin/scenemint-canvas.mjs" 2>/dev/null || true
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "$(basename "${SHELL:-sh}")" in
      zsh)  RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash) if [ -f "$HOME/.bashrc" ]; then RC="$HOME/.bashrc"; else RC="$HOME/.bash_profile"; fi ;;
      *)    RC="$HOME/.profile" ;;
    esac
    # shellcheck disable=SC2016  # $PATH 要以字面量写进 rc 文件，不能在此展开
    printf '\n# scenemint-canvas\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$RC"
    say "已将 $BIN_DIR 写入 ${RC}，请执行: source $RC"
    ;;
esac

say "scenemint-canvas 已安装: $BIN_LINK ($(node "$BIN_LINK" --version 2>/dev/null || echo '?'))"
say "Skill 目录: $(node "$BIN_LINK" skill-path 2>/dev/null)"
say "后续更新请重跑本安装命令"
