import { basename } from "node:path"

/** kebab-case segments separated by dots: `stream-parser.ts`, `srt.integration.test.ts`, `hello.eval.ts`. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/

/**
 * Requires kebab-case file names, so a module is found by its name whatever the OS's case sensitivity.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
export const filenameCase = {
  meta: {
    type: "suggestion",
    docs: { description: "File names are kebab-case." },
    schema: [],
    messages: { kebab: "File name '{{name}}' is not kebab-case: rename it, e.g. 'stream-parser.ts'." },
  },
  create(context) {
    return {
      Program(node) {
        const name = basename(context.filename)
        if (!KEBAB.test(name)) context.report({ node, messageId: "kebab", data: { name } })
      },
    }
  },
}
