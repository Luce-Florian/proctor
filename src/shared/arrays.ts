/**
 * The values that occur more than once in `values`, each listed once, in the order of their first repeat.
 *
 * @example
 * duplicates(["pgsql", "tickets", "pgsql", "pgsql"]) // ["pgsql"]
 */
export function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}
