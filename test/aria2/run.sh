#!/usr/bin/env bash
# 真实 aria2 验收：两个一次性 aria2c 容器 + 构建后的 AriaNg + Playwright Chromium，回读 aria2 状态和实际写入的文件。
# 用法：test/aria2/run.sh            检查当前工作区
#       test/aria2/run.sh 2.2.4      检查某个已提交版本，用作修复前对照（场景脚本始终取自当前工作区）
# 只需要 Docker；不连接个人 RPC，下载文件由验收容器自己提供。报告写入 test-results/aria2/。
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REF="${1:-}"
LABEL="${REF:-worktree}"
PREFIX="ariang-aria2-qa"
ARIA2_IMAGE="${ARIA2_IMAGE:-superng6/aria2:latest}"
RUNNER_IMAGE="${RUNNER_IMAGE:-ariang-aria2-qa-runner:local}"
DATA="$(mktemp -d)"
OUT="$ROOT/test-results/aria2"

remove_containers() {
    docker rm -f "$PREFIX-a" "$PREFIX-b" "$PREFIX-s" "$PREFIX-web" >/dev/null 2>&1
    docker network rm "$PREFIX" >/dev/null 2>&1
}
cleanup() {
    remove_containers
    # aria2 以 root 写入下载文件；用容器删除，宿主普通用户也能清理干净。
    docker run --rm -v "$DATA:/data" --entrypoint sh "$ARIA2_IMAGE" -c 'rm -rf /data/*' >/dev/null 2>&1
    rm -rf "$DATA"
}
trap cleanup EXIT

if ! docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
    echo "building $RUNNER_IMAGE" >&2
    docker build -q -t "$RUNNER_IMAGE" -f "$ROOT/test/aria2/runner.Dockerfile" "$ROOT/test/aria2" >/dev/null || exit 1
fi

remove_containers
mkdir -p "$OUT" "$DATA"/a/{downloads,cwd} "$DATA"/b/{downloads,cwd} "$DATA"/s "$DATA"/torrents
docker network create "$PREFIX" >/dev/null || exit 1
# 所有 aria2 只通过验收网络内的 tracker 互相发现，不访问外部 DHT 或本地广播。
BT_ISOLATION="--enable-dht=false --enable-dht6=false --bt-enable-lpd=false"
for side in a b; do
    docker run -d --name "$PREFIX-$side" --network "$PREFIX" -v "$DATA:/data" -w "/data/$side/cwd" \
        --entrypoint aria2c "$ARIA2_IMAGE" --enable-rpc --rpc-listen-all --rpc-allow-origin-all \
        --rpc-listen-port=6800 --rpc-secret=qa-secret --dir="/data/$side/downloads" \
        --max-tries=1 --retry-wait=0 --console-log-level=warn $BT_ISOLATION --seed-time=0 --max-concurrent-downloads=20 >/dev/null || exit 1
done
# 做种容器 S：只为 BT 场景提供数据，持续做种。
docker run -d --name "$PREFIX-s" --network "$PREFIX" -v "$DATA:/data" -w /data/s \
    --entrypoint aria2c "$ARIA2_IMAGE" --enable-rpc --rpc-listen-all --rpc-allow-origin-all \
    --rpc-listen-port=6800 --rpc-secret=qa-secret --dir=/data/s --console-log-level=warn \
    $BT_ISOLATION --seed-ratio=0.0 --max-concurrent-downloads=20 >/dev/null || exit 1

docker run --rm --name "$PREFIX-web" --network "$PREFIX" \
    -v "$ROOT:/src:ro" -v "$DATA:/data" -v "$OUT:/out" \
    -v ariang-npm-cache:/root/.npm -v ariang-playwright:/pw \
    -e REF="$REF" -e LABEL="$LABEL" -e QA_PREFIX="$PREFIX" "$RUNNER_IMAGE" bash -c '
        step() { echo "[$(date +%T)] $*" >&2; }
        cp -r /src /work && cd /work || exit 1
        # /work 是容器内副本；检查旧版本时丢弃副本里的未提交改动，宿主工作区以只读挂载不受影响。
        if [ -n "$REF" ]; then git -c advice.detachedHead=false checkout -q -f "$REF" && git clean -fdq || exit 1; fi
        step "npm ci"; timeout 300 npm ci --no-audit --no-fund >/tmp/ci.log 2>&1 || { tail -5 /tmp/ci.log; exit 1; }
        step "build"; timeout 300 npx gulp clean build >/tmp/build.log 2>&1 || { tail -5 /tmp/build.log; exit 1; }
        if [ ! -d /pw/node_modules/playwright ]; then
            step "install playwright"
            timeout 300 npm install --prefix /pw --no-package-lock --no-audit --no-fund playwright@1.62.1 >/tmp/pw.log 2>&1 || { tail -5 /tmp/pw.log; exit 1; }
        fi
        export PLAYWRIGHT_BROWSERS_PATH=/pw/browsers ARIANG_PLAYWRIGHT_MODULE=/pw/node_modules/playwright
        step "chromium"; timeout 300 /pw/node_modules/.bin/playwright install chromium >/tmp/pw.log 2>&1 || { tail -5 /tmp/pw.log; exit 1; }
        step "scenarios on $(node -p "require(\"./package.json\").version") ($LABEL)"
        status=0
        timeout 300 node /src/test/aria2/real-aria2.cjs "$LABEL" /work/dist "/out/$LABEL.json" || status=1
        step "BT scenarios ($LABEL)"
        timeout 600 node /src/test/aria2/real-aria2-bt.cjs "$LABEL" /work/dist "/out/$LABEL-bt.json" || status=1
        exit $status'
