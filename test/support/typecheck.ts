import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../..", import.meta.url))

/**
 * Typechecks `source` as if it were a `*.eval.ts` of the package, without writing it: `@fluce/proctor` resolves through
 * the package's self-reference, as it does for `examples/`. Used to keep the examples of the docs compiling.
 *
 * @example
 * expect(typeErrors('import { suite } from "@fluce/proctor"\nexport default suite("s")\n')).toEqual([])
 */
export function typeErrors(source: string): string[] {
  const config = ts.getParsedCommandLineOfConfigFile(
    `${root}tsconfig.json`,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  )
  if (!config) throw new Error("tsconfig.json not found")
  const file = `${root}examples/doc-example.eval.ts`
  const host = ts.createCompilerHost(config.options)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const read = host.readFile.bind(host)
  host.fileExists = (name) => name === file || fileExists(name)
  host.readFile = (name) => (name === file ? source : read(name))
  host.getSourceFile = (name, version, ...rest) =>
    name === file ? ts.createSourceFile(name, source, version) : getSourceFile(name, version, ...rest)
  const program = ts.createProgram([file], config.options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `${d.file?.fileName === file ? "example" : d.file?.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`)
}
