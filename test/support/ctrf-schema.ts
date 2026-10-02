import { readFileSync } from "node:fs"
import { Ajv } from "ajv"
import addFormats from "ajv-formats"

/**
 * Official CTRF JSON schema, vendored unchanged from
 * https://github.com/ctrf-io/ctrf/blob/66e823ca2c9e1f54bf8b387adda0b7e0c7610538/schema/ctrf.schema.json
 */
const schema: object = JSON.parse(readFileSync(new URL("../fixtures/ctrf/ctrf.schema.json", import.meta.url), "utf8"))

const ajv = new Ajv({ allErrors: true, strict: true })
addFormats.default(ajv)
const validate = ajv.compile(schema)

/** Returns the schema violations of a CTRF document, empty when valid. */
export function ctrfErrors(document: unknown): string[] {
  return validate(document) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`)
}
