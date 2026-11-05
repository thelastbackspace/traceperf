#!/usr/bin/env bash
# Run the Cloudflare Workers smoke test with workerd.
#   WORKERD=/path/to/workerd test/runtimes/workerd.sh   (after npm run build:all)
set -euo pipefail
cd "$(dirname "$0")"
WORKERD="${WORKERD:-npx --yes workerd}"
npx esbuild ../../dist/esm/index.js --bundle --format=esm --platform=neutral --main-fields=module,main \
  --log-level=error --outfile=traceperf.bundle.mjs
$WORKERD serve workerd.capnp >workerd.log 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; rm -f traceperf.bundle.mjs' EXIT
for _ in $(seq 1 100); do
  if out=$(curl -sf http://127.0.0.1:8790/ 2>/dev/null); then break; fi
  sleep 0.2
done
echo "workerd: $out"
node -e '
const r = JSON.parse(process.argv[1]);
const nested = JSON.stringify([["root", ["child"]]]);
if (JSON.stringify(r.explicit.trees) !== nested) throw new Error("explicit AsyncLocalStorage: nesting broken");
if (!(r.explicit.duration >= 9)) throw new Error("timing broken");
console.log("workerd: nesting across await OK (explicit AsyncLocalStorage), auto-detected:", JSON.stringify(r.auto.trees));
' "$out"
