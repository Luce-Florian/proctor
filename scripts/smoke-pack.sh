#!/usr/bin/env bash
# Installs a packed tarball in a fresh ES module project, typechecks an eval file against the published types,
# then lists and runs it with the fake agent. Usage: scripts/smoke-pack.sh /abs/path/fluce-proctor-x.y.z.tgz
set -euo pipefail

tarball="$1"
project="$(mktemp -d)"
trap 'rm -rf "$project"' EXIT
cd "$project"

echo '{ "name": "proctor-smoke", "private": true, "type": "module" }' > package.json
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": { "target": "ES2022", "module": "nodenext", "moduleResolution": "nodenext", "strict": true, "noEmit": true, "types": ["node"] },
  "include": ["*.ts"]
}
JSON
cat > hello.eval.ts <<'TS'
import { regex, suite } from "@fluce/proctor"
import { FakeAgentAdapter } from "@fluce/proctor/testing"

export default suite(typeof FakeAgentAdapter === "function" ? "smoke" : "broken")
  .variant("baseline", (v) => v.prompt("Say hello"))
  .case("greets", (c) => c.expect(regex("says-hello", /hello/i)))
TS

npm install --no-audit --no-fund "$tarball" typescript@~6.0.3 @types/node@22
npx tsc -p .
test "$(npx proctor list hello.eval.ts | head -1)" = "smoke"
npx proctor run hello.eval.ts --agent fake --out results
