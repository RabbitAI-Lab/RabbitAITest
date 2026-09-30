#!/usr/bin/env bash
# rabbit（RabbitAITest CLI）快捷打包脚本 —— 不依赖 make，只需要 Go 工具链
# [vendored from RabbitAI-Lab/RabbitCLI-Bootstrap@a351e12；NAME 缺省改 rabbit]
#
# 用法：
#   ./build.sh                     # 本机平台构建 -> bin/rabbit
#   ./build.sh --name acmecli      # 改名构建（env 前缀、配置目录、日志名全部自动跟随）
#   ./build.sh --version 1.2.3     # 指定版本号（注入 -v / update --check）
#   ./build.sh --release           # 全平台交叉编译 -> dist/（含麒麟 amd64/arm64/loong64）
#   ./build.sh --install           # 构建并安装到 /usr/local/bin
#   ./build.sh --clean             # 清理 bin/ dist/
#
# 环境变量覆盖：NAME、VERSION、GO（go 命令路径）
set -euo pipefail
cd "$(dirname "$0")"

NAME="${NAME:-rabbit}"
VERSION="${VERSION:-0.1.0}"
GO="${GO:-go}"
PKG="github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/cli"
LDFLAGS="-s -w -X ${PKG}.Version=${VERSION} -X ${PKG}.Name=${NAME}"
CMD="./cmd/rabbitcli"

DO_RELEASE=0
DO_INSTALL=0
DO_CLEAN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --name)    NAME="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --release) DO_RELEASE=1; shift ;;
    --install) DO_INSTALL=1; shift ;;
    --clean)   DO_CLEAN=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

if [ "$DO_CLEAN" = 1 ]; then
  rm -rf bin dist
  echo "已清理 bin/ dist/"
  [ "$DO_RELEASE" = 0 ] && [ "$DO_INSTALL" = 0 ] && [ $# -eq 0 ] && exit 0
fi

command -v "$GO" >/dev/null 2>&1 || { echo "错误：未找到 Go 工具链（可用 GO=/path/to/go 指定）" >&2; exit 1; }
LDFLAGS="-s -w -X ${PKG}.Version=${VERSION} -X ${PKG}.Name=${NAME}"

build_one() { # $1=GOOS $2=GOARCH $3=输出路径
  echo ">> $3"
  CGO_ENABLED=0 GOOS="$1" GOARCH="$2" "$GO" build -trimpath -ldflags "$LDFLAGS" -o "$3" "$CMD"
}

if [ "$DO_RELEASE" = 1 ]; then
  mkdir -p dist
  build_one linux   amd64   "dist/${NAME}-linux-amd64"
  build_one linux   arm64   "dist/${NAME}-linux-arm64"
  build_one linux   loong64 "dist/${NAME}-linux-loong64"   # 麒麟（龙芯）
  build_one darwin  amd64   "dist/${NAME}-darwin-amd64"
  build_one darwin  arm64   "dist/${NAME}-darwin-arm64"
  build_one windows amd64   "dist/${NAME}-windows-amd64.exe"
  (cd dist && shasum -a 256 * > SHA256SUMS.txt 2>/dev/null || sha256sum * > SHA256SUMS.txt)
  echo
  echo "release 产物（dist/）："
  ls -lh dist/
else
  mkdir -p bin
  build_one "" "" "bin/${NAME}"
  # 静态性自检：静态二进制 ldd 应报 "not a dynamic executable"
  if command -v ldd >/dev/null 2>&1 && ldd "bin/${NAME}" 2>&1 | grep -q "not a dynamic executable"; then
    echo "静态链接确认：无运行时依赖"
  fi
  echo
  echo "完成：bin/${NAME}"
  "bin/${NAME}" -v || true
fi

if [ "$DO_INSTALL" = 1 ]; then
  install -m 755 "bin/${NAME}" "/usr/local/bin/${NAME}"
  echo "已安装到 /usr/local/bin/${NAME}"
fi
