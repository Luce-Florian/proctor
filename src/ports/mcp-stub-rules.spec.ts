import { describe, expect, it } from "vitest"
import type { McpAnswer } from "./mcp-stub.ts"
import { BUILT_IN_FALLBACK, matchesInput, REGEX_KEY, reviveStub, serializeStub, StubResponder } from "./mcp-stub-rules.mjs"
import { stub, stubTool } from "#test/mcp-stubs.ts"

const text = (content: string): McpAnswer => ({ content, isError: false })
const error = (content: string): McpAnswer => ({ content, isError: true })

describe("StubResponder", () => {
  it("answers with the first matching rule, and says where the rule comes from", () => {
    const details = stubTool("get_object_details", {
      rules: [
        { when: { object_name: "customers" }, answers: [text("customers")], answeredBy: "case" },
        { when: { object_name: "orders" }, answers: [text("orders")], answeredBy: "case" },
        { answers: [error("relation does not exist")], answeredBy: "stub" },
      ],
    })

    const resolution = new StubResponder(stub("pgsql", details)).answer("get_object_details", { object_name: "orders" })

    expect(resolution).toEqual({ answer: text("orders"), answeredBy: "case" })
  })

  it("answers with a rule of the stub when no rule of the case matches", () => {
    const details = stubTool("get_object_details", {
      rules: [
        { when: { object_name: "orders" }, answers: [text("orders")], answeredBy: "case" },
        { answers: [error("relation does not exist")], answeredBy: "stub" },
      ],
    })

    const resolution = new StubResponder(stub("pgsql", details)).answer("get_object_details", { object_name: "customers" })

    expect(resolution).toEqual({ answer: error("relation does not exist"), answeredBy: "stub" })
  })

  it("gives the answers of a rule in order, then repeats the last one", () => {
    const status = stubTool("get_job_status", { rules: [{ answers: [text("running"), text("done")], answeredBy: "stub" }] })
    const responder = new StubResponder(stub("pgsql", status))

    const answers = [1, 2, 3].map(() => responder.answer("get_job_status", {}).answer)

    expect(answers).toEqual([text("running"), text("done"), text("done")])
  })

  it.each([
    ["the tool's otherwise", stub("pgsql", stubTool("execute_sql", { otherwise: error("permission denied") })), error("permission denied")],
    [
      "the server's otherwise",
      { ...stub("pgsql", stubTool("execute_sql")), otherwise: error("unknown instance") },
      error("unknown instance"),
    ],
    ["the built-in fallback", stub("pgsql", stubTool("execute_sql")), BUILT_IN_FALLBACK],
  ])("answers a call no rule matches with %s", (_, definition, expected) => {
    expect(new StubResponder(definition).answer("execute_sql", { sql: "select 1" })).toEqual({ answer: expected, answeredBy: "fallback" })
  })

  it("answers a call to a tool it does not declare with a tool error", () => {
    const resolution = new StubResponder(stub("pgsql")).answer("drop_table", {})

    expect(resolution).toEqual({ answer: error('Unknown tool "drop_table".'), answeredBy: "fallback" })
  })
})

describe("matchesInput", () => {
  const input = { instance: "prod", object_name: "public.orders", columns: ["customer_id"], options: { verbose: true } }

  it.each([
    ["no pattern matches any input", undefined, true],
    ["an object pattern ignores the input keys it does not name", { instance: "prod" }, true],
    ["a value must be equal", { instance: "staging" }, false],
    ["a missing key does not match", { schema: "public" }, false],
    ["a RegExp value matches the string it finds", { object_name: /^(public\.)?orders$/ }, true],
    ["a RegExp value only matches a string", { options: /verbose/ }, false],
    ["an array matches element by element", { columns: ["customer_id"] }, true],
    ["an array of another length does not match", { columns: ["customer_id", "created_at"] }, false],
    ["a nested object matches recursively", { options: { verbose: true } }, true],
    ["a RegExp as the whole pattern matches the JSON of the input", /"object_name":"public\.orders"/, true],
  ])("%s", (_, when, expected) => {
    expect(matchesInput(when, input)).toBe(expected)
  })
})

describe("serializeStub", () => {
  it("writes a definition that reviveStub reads back, RegExp included", () => {
    const definition = stub(
      "pgsql",
      stubTool("execute_sql", { rules: [{ when: /reltuples/i, answers: [text("180000000")], answeredBy: "stub" }] }),
    )

    expect(reviveStub(serializeStub(definition), "pgsql.json")).toEqual(definition)
  })
})

describe("the key a RegExp crosses under", () => {
  it("is the one serializeStub writes a RegExp under", () => {
    const definition = stub("pgsql", stubTool("execute_sql", { rules: [{ when: /reltuples/i, answers: [text("1")], answeredBy: "stub" }] }))

    const written: unknown = JSON.parse(serializeStub(definition))

    expect(written).toMatchObject({ tools: [{ rules: [{ when: { [REGEX_KEY]: "reltuples", flags: "i" } }] }] })
  })
})

describe("reviveStub", () => {
  it.each([
    ["text that is not JSON", "not json", "not JSON"],
    ["a definition without tools", '{"server":"pgsql"}', '"tools" is not an array'],
    [
      "a rule that does not say where it comes from",
      '{"server":"pgsql","tools":[{"name":"q","inputSchema":{},"rules":[{"answers":[{"content":"x","isError":false}]}]}]}',
      'tool 1: rule 1: "answeredBy" is neither "case" nor "stub"',
    ],
    [
      "an answer without isError",
      '{"server":"pgsql","tools":[{"name":"q","inputSchema":{},"rules":[],"otherwise":{"content":"x"}}]}',
      "tool 1: otherwise is not an answer",
    ],
  ])("refuses %s, naming the file", (_, text, problem) => {
    expect(() => reviveStub(text, "/home/.proctor/mcp/pgsql.json")).toThrow(
      `/home/.proctor/mcp/pgsql.json is not an MCP stub configuration the harness wrote: ${problem}`,
    )
  })
})
