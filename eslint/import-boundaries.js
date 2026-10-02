import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

const DEFAULT_HINT = "depend on a port in src/ports/ and let the CLI wire the implementation"

/**
 * Enforces the package architecture on relative imports and on imports of the package by its own name
 * (`@fluce/proctor`, `@fluce/proctor/testing`, resolved through `exports`), static, dynamic and re-exports:
 * - nothing imports a file outside `root`, so the package stays self-contained;
 * - a file under `from` never imports a file under one of `to`, unless the target is under one of `allow` or the
 *   importer under one of `except`; `hint` says what to do instead. With `to: ["src"]` and an `allow` list, a layer is
 *   closed by default: a directory added later is refused until the config allows it;
 * - an `import()` of a computed path, which no static check can follow, only happens in `computedImports` files.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const importBoundaries = {
  meta: {
    type: "problem",
    docs: { description: "Keep core/ and ports/ free of concrete implementations, and the package self-contained." },
    schema: [
      {
        type: "object",
        properties: {
          root: { type: "string" },
          packageName: { type: "string" },
          exports: { type: "object", additionalProperties: { type: "string" } },
          computedImports: { type: "array", items: { type: "string" } },
          forbidden: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "array", items: { type: "string" } },
                allow: { type: "array", items: { type: "string" } },
                except: { type: "array", items: { type: "string" } },
                hint: { type: "string" },
              },
              required: ["from", "to"],
            },
          },
        },
        required: ["root"],
      },
    ],
    messages: {
      outside: "'{{source}}' is outside the proctor package: inject the path through the config instead.",
      forbidden: "{{from}}/ must not import {{to}}: {{hint}}.",
      computed:
        "import() of a computed path escapes the import boundaries: import a literal path, or load user files through src/loaders/.",
    },
  },
  create(context) {
    const { root, packageName, exports = {}, forbidden = [], computedImports = [] } = context.options[0]
    const within = (path, dir) => path === dir || path.startsWith(`${dir}${sep}`)
    const importer = relative(root, context.filename)

    /** Absolute file an import points to inside the package, or undefined for a third-party package. */
    const resolveSource = (source) => {
      if (source.startsWith(".") || isAbsolute(source)) return resolve(dirname(context.filename), source)
      if (source !== packageName && !source.startsWith(`${packageName}/`)) return undefined
      const entry = exports[`.${source.slice(packageName.length)}`]
      return entry === undefined ? undefined : resolve(root, entry)
    }

    const check = (node, source) => {
      const resolved = typeof source === "string" ? resolveSource(source) : undefined
      if (resolved === undefined) return
      const target = relative(root, resolved)
      if (target.startsWith("..") || isAbsolute(target)) {
        context.report({ node, messageId: "outside", data: { source } })
        return
      }
      for (const rule of forbidden) {
        const to = rule.to.find((dir) => within(target, dir))
        const exempt = (rule.except ?? []).some((dir) => within(importer, dir)) || (rule.allow ?? []).some((dir) => within(target, dir))
        if (!within(importer, rule.from) || !to || exempt) continue
        // The top-level entry the target belongs to (`src/adapters/`, `src/index.ts`), whatever `to` lists.
        const [top = "", entry = ""] = target.split(sep)
        const shown = entry.endsWith(".ts") ? join(top, entry) : `${join(top, entry)}/`
        context.report({ node, messageId: "forbidden", data: { from: rule.from, to: shown, hint: rule.hint ?? DEFAULT_HINT } })
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ImportExpression: (node) => {
        if (node.source.type === "Literal") check(node, node.source.value)
        else if (!computedImports.some((file) => importer === file)) context.report({ node, messageId: "computed" })
      },
    }
  },
}
