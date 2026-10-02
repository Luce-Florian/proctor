import type { SuiteDefinition } from "../core/model.ts"

/** Turns a file into a suite definition. One loader per file format. */
export interface SuiteLoader {
  /** e.g. `*.eval.ts` */
  readonly accepts: string
  canLoad(path: string): boolean
  load(path: string): Promise<SuiteDefinition>
}
