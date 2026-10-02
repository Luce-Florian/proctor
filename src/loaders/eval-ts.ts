import { pathToFileURL } from "node:url"
import { isSuiteBuilder } from "../dsl/suite.ts"
import type { SuiteLoader } from "./loader.ts"

/**
 * Loads a `*.eval.ts` file whose default export is a `suite(...)` builder.
 * TypeScript is compiled on the fly: the CLI runs under tsx. The file imports the package by name, so it lives in a
 * project that installs `@fluce/proctor`, and loads as an ES module: under a `package.json` of `"type": "module"`, or
 * named `*.eval.mts`. Elsewhere tsx compiles it to CommonJS, and Node refuses to `require()` it.
 *
 * @example
 * const definition = await evalTsLoader.load("/abs/path/hello.eval.ts")
 */
export const evalTsLoader: SuiteLoader = {
  accepts: "*.eval.ts",
  canLoad: (path) => /\.eval\.[cm]?[jt]s$/.test(path),
  load: async (path) => {
    const module: unknown = await import(pathToFileURL(path).href)
    const exported = typeof module === "object" && module !== null && "default" in module ? module.default : undefined
    if (!isSuiteBuilder(exported)) {
      throw new Error(`"${path}" has no default export: add \`export default suite("name")...\` to it.`)
    }
    return exported.toDefinition()
  },
}
