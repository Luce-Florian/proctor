import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import packageJson from "./package.json" with { type: "json" }

// Eval files import the package by name ("@fluce/proctor", "@fluce/proctor/testing"): alias each entry of
// package.json "exports" to the source file of its "source" condition, as Node's self-reference does at runtime.
const alias = Object.entries(packageJson.exports).flatMap(([subpath, target]) =>
  typeof target === "object"
    ? [
        {
          find: new RegExp(`^${packageJson.name.replaceAll("/", "\\/")}${subpath.slice(1).replaceAll("/", "\\/")}$`),
          replacement: fileURLToPath(new URL(target.source, import.meta.url)),
        },
      ]
    : [],
)

export default defineConfig({
  resolve: { alias },
  test: {
    // Clears credential variables and blocks outbound network for every test file.
    setupFiles: ["test/support/setup.ts"],
    testTimeout: 30_000,
    projects: [
      // One module at a time, next to its source: `npm run test:unit`.
      { extends: true, test: { name: "unit", include: ["src/**/*.spec.ts", "scripts/**/*.spec.ts"] } },
      // The package as a user drives it (DSL, runSuite, CLI, docs): `npm run test:behavior`.
      { extends: true, test: { name: "behavior", include: ["test/**/*.test.ts"] } },
    ],
  },
})
