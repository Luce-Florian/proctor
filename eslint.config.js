import { builtinModules } from "node:module"
import { join } from "node:path"
import { defineConfig } from "eslint/config"
import prettier from "eslint-config-prettier/flat"
import tseslint from "typescript-eslint"
import { filenameCase } from "./eslint/filename-case.js"
import { importBoundaries } from "./eslint/import-boundaries.js"
import packageJson from "./package.json" with { type: "json" }

// Each package entry by its subpath, mapped to the source file its "source" condition points to.
const sourceExports = Object.fromEntries(
  Object.entries(packageJson.exports).flatMap(([subpath, target]) => (typeof target === "object" ? [[subpath, target.source]] : [])),
)

const root = import.meta.dirname
const src = (...path) => join("src", ...path)
/** What a behavior test may import: the package as a user gets it, and the plugs a run wires (CLI, loaders, adapters). */
const userFacing = [src("index.ts"), src("testing"), src("cli", "main.ts"), src("loaders"), src("adapters")]

const builtins = builtinModules.filter((name) => !name.startsWith("_") && !name.includes("/")).join("|")
/** Conventions the code already follows, checked so that a review never has to. */
const restricted = [
  {
    selector: `:matches(ImportDeclaration, ImportExpression, ExportAllDeclaration, ExportNamedDeclaration)[source.value=/^(?:${builtins})(?:$|[^a-z0-9_-])/]`,
    message: "Import Node built-ins with the node: prefix, e.g. node:fs/promises.",
  },
  {
    selector: ":matches(PropertyDefinition, MethodDefinition, TSParameterProperty)[accessibility=/^(private|public)$/]",
    message: "Use #private members (runtime privacy), and no `public` keyword: members are public by default.",
  },
]

export default defineConfig(
  // docs/ is a separate VitePress project, with its own package.json.
  { ignores: ["node_modules/", "results/", "dist/", "coverage/", "docs/"] },
  // Type-aware: the rules read the types, so they catch what the compiler lets through (floating promises,
  // conditions always true, unsafe values from JSON.parse).
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } } },
  {
    plugins: { local: { rules: { "import-boundaries": importBoundaries, "filename-case": filenameCase } } },
    rules: {
      "local/filename-case": "error",
      "no-restricted-syntax": ["error", ...restricted],
      // A chain of `a ? b : c ? d : e` reads as a puzzle: early returns or a lookup table say the same plainly.
      "no-nested-ternary": "error",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      // A count or a duration reads naturally in a message; objects and undefined still need an explicit format.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // `() => void cleanup()` and `(x) => list.push(x)` are the idiom for callbacks that return nothing.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // An `async` method that implements a Promise-returning port turns a sync throw into a rejection: wanted.
      "@typescript-eslint/require-await": "off",
      "local/import-boundaries": [
        "error",
        {
          root,
          packageName: packageJson.name,
          exports: sourceExports,
          // The eval-ts loader imports the user's *.eval.ts file: the one computed import of the package.
          computedImports: [src("loaders", "eval-ts.ts")],
          // Closed by default: each layer lists what it may import, so a directory added later is refused until allowed.
          forbidden: [
            // core/ only knows ports and the model: no agent, sandbox or output format.
            { from: src("core"), to: ["src"], allow: [src("core"), src("ports"), src("shared")] },
            // Ports are the innermost layer: core depends on them, never the reverse.
            { from: src("ports"), to: ["src"], allow: [src("ports"), src("shared")] },
            // Plain utilities (paths, text, ids): a leaf every layer may use, so it imports none of them.
            { from: src("shared"), to: ["src"], allow: [src("shared")], hint: "keep src/shared/ free of the package's layers" },
            {
              from: "test",
              to: ["src"],
              allow: userFacing,
              // Shared by the specs too, which test internals.
              except: [join("test", "support")],
              hint: "a behavior test drives the package as a user does (@fluce/proctor, @fluce/proctor/testing, the CLI, a loader or an adapter); test a module on its own in a *.spec.ts next to it",
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      // Contradicts no-non-null-assertion: `x as T` would become `x!`, which the strict config refuses.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
    },
  },
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    ignores: ["**/*.spec.ts"],
    rules: {
      // The exported surface is read in the editor's hover: its types are written, not inferred.
      "@typescript-eslint/explicit-module-boundary-types": "error",
      // Named exports only: one name per symbol, found by search and auto-import. `*.eval.ts` files keep theirs.
      "no-restricted-syntax": ["error", ...restricted, { selector: "ExportDefaultDeclaration", message: "Use a named export." }],
    },
  },
  {
    files: ["**/*.spec.ts", "test/**/*.ts"],
    rules: {
      // Vitest types its asymmetric matchers (`expect.any`, `expect.stringContaining`…) and parsed reports as `any`;
      // an assertion on the wrong shape fails the test anyway.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Stubs: `() => {}` is a callback that does nothing on purpose.
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  // Plain JavaScript (bin/, eslint/, this file) is not part of the TypeScript project.
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  // Last: turns off every stylistic rule Prettier owns, so lint and format never disagree.
  prettier,
)
