import { access } from "node:fs/promises"
import type { SuiteDefinition } from "../core/model.ts"
import { evalTsLoader } from "./eval-ts.ts"
import { legacyJsonLoader } from "./legacy-json.ts"
import type { SuiteLoader } from "./loader.ts"

/** Registered loaders, tried in order. Add a format by adding a loader here. */
export const loaders: readonly SuiteLoader[] = [evalTsLoader, legacyJsonLoader]

/**
 * Loads a suite with the first loader that accepts the file.
 *
 * @example
 * const definition = await loadSuite("/abs/path/hello.eval.ts")
 */
export async function loadSuite(path: string, available: readonly SuiteLoader[] = loaders): Promise<SuiteDefinition> {
  const loader = available.find((l) => l.canLoad(path))
  if (!loader) {
    throw new Error(`Cannot load "${path}": expected one of ${available.map((l) => l.accepts).join(", ")}.`)
  }
  await access(path).catch(() => {
    throw new Error(`Eval file not found: ${path}. Check the path: a relative path is resolved from the current directory.`)
  })
  return loader.load(path)
}
