import { existsSync, realpathSync, statSync } from "node:fs"

/**
 * Whether `path` exists and is a directory; never throws.
 *
 * @example
 * isDirectory("evals/my-theme/cases") // true
 */
export function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

/**
 * Real path of a directory, or the path itself when it does not resolve (macOS temp dirs live under `/private/var`).
 *
 * @example
 * realPath("/var/folders/x") // "/private/var/folders/x"
 */
export function realPath(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}
