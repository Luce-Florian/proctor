import { describe, expect, it } from "vitest"
import { typeErrors } from "#test/typecheck.ts"
import { regex } from "../graders/regex.ts"
import { mcpError, mcpStub, type McpStub } from "./mcp-stub.ts"
import { suite, type SuiteBuilder } from "./suite.ts"

const anyAnswer = regex("any-answer", /./)

/** The catalog of a PostgreSQL server, as a SQL review skill expects it. */
const pgsql = mcpStub("pgsql")
  .tool("list_instances", (t) => t.description("Lists the instances.").returns({ instances: ["prod"] }))
  .tool("get_object_details", (t) => t.otherwise(mcpError("relation does not exist")))

/** The definition of the tool `name` of `stub`. */
function toolOf(stub: McpStub, name: string) {
  const tool = stub.toDefinition().tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`no tool "${name}"`)
  return tool
}

/** Builds a suite whose single variant declares `pgsql`, with the given case configuration. */
const suiteWithPgsql = (configure: Parameters<SuiteBuilder["case"]>[1]) =>
  suite("sql-review")
    .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt("Review change.diff"))
    .case("index-exists", configure)
    .toDefinition()

describe("mcpStub builder", () => {
  it("declares each tool in declaration order, with the description the agent reads", () => {
    const stub = mcpStub("pgsql")
      .tool("list_instances", (t) => t.description("Lists the instances."))
      .tool("execute_sql", (t) => t)

    expect(stub.toDefinition().tools.map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "list_instances", description: "Lists the instances." },
      { name: "execute_sql", description: undefined },
    ])
  })

  it("defaults the input schema of a tool to an object", () => {
    const stub = mcpStub("pgsql").tool("list_instances", (t) => t)

    expect(toolOf(stub, "list_instances").inputSchema).toEqual({ type: "object" })
  })

  it("sends the input schema a tool declares", () => {
    const schema = { type: "object", properties: { sql: { type: "string" } } }

    const stub = mcpStub("pgsql").tool("execute_sql", (t) => t.inputSchema(schema))

    expect(toolOf(stub, "execute_sql").inputSchema).toEqual(schema)
  })

  it("answers any input with .returns(), as a rule of the stub", () => {
    const stub = mcpStub("pgsql").tool("list_instances", (t) => t.returns({ instances: ["prod"] }))

    expect(toolOf(stub, "list_instances").rules).toEqual([
      { answers: [{ content: { instances: ["prod"] }, isError: false }], answeredBy: "stub" },
    ])
  })

  it("answers the inputs a pattern matches with the answers of .returnsInOrder(), a tool error with mcpError()", () => {
    const stub = mcpStub("pgsql").tool("execute_sql", (t) => t.on(/reltuples/).returnsInOrder("180000000", mcpError("statement timeout")))

    expect(toolOf(stub, "execute_sql").rules).toEqual([
      {
        when: /reltuples/,
        answers: [
          { content: "180000000", isError: false },
          { content: "statement timeout", isError: true },
        ],
        answeredBy: "stub",
      },
    ])
  })

  it("keeps the rules of a tool in declaration order", () => {
    const stub = mcpStub("pgsql").tool("execute_sql", (t) =>
      t
        .on(/reltuples/)
        .returns("180000000")
        .returns(mcpError("permission denied")),
    )

    expect(toolOf(stub, "execute_sql").rules.map((rule) => rule.answers[0]?.content)).toEqual(["180000000", "permission denied"])
  })

  it("answers with the server's otherwise what no tool answers", () => {
    const stub = mcpStub("pgsql").otherwise(mcpError("unknown instance"))

    expect(stub.toDefinition().otherwise).toEqual({ content: "unknown instance", isError: true })
  })

  it("is immutable: adding a tool leaves the stub it was added to unchanged", () => {
    const base = mcpStub("pgsql")

    base.tool("list_instances", (t) => t.returns([]))

    expect(base.toDefinition().tools).toEqual([])
  })

  it.each([
    ["a tool the stub lacks", 's.on("explain_query").returns("plan")', "Argument of type '\"explain_query\"' is not assignable"],
    ["a rule left without an answer", 's.on("get_object_details")', "McpRuleAnswer<McpStubRules<"],
  ])("refuses case rules for %s at compile time", (_, rules, error) => {
    const evalFile = `import { mcpStub, regex, suite } from "@fluce/proctor"
const pgsql = mcpStub("pgsql").tool("get_object_details", (t) => t.returns({}))
export default suite("sql-review")
  .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt("Review change.diff"))
  .case("index-exists", (c) => c.mcpStub(pgsql, (s) => ${rules}).expect(regex("any-answer", /./)))
`

    expect(typeErrors(evalFile)).toEqual([expect.stringContaining(error)])
  })

  it("keeps the case rules of each c.mcpStub() call, in declaration order", () => {
    const definition = suiteWithPgsql((c) =>
      c
        .mcpStub(pgsql, (s) => s.on("get_object_details", { object_name: "orders" }).returns({ table: "public.orders" }))
        .mcpStub(pgsql, (s) => s.on("get_object_details").returns(mcpError("timeout")))
        .expect(anyAnswer),
    )

    expect(definition.cases[0]?.mcpStubRules).toEqual([
      {
        server: "pgsql",
        rules: [
          {
            tool: "get_object_details",
            when: { object_name: "orders" },
            answers: [{ content: { table: "public.orders" }, isError: false }],
          },
        ],
      },
      { server: "pgsql", rules: [{ tool: "get_object_details", answers: [{ content: "timeout", isError: true }] }] },
    ])
  })
})

describe("mcpStub validation", () => {
  it("refuses case rules for a stub no variant declares", () => {
    const tickets = mcpStub("tickets").tool("get_ticket", (t) => t.returns({}))

    const build = () => suiteWithPgsql((c) => c.mcpStub(tickets, (s) => s.on("get_ticket").returns({ id: 1 })).expect(anyAnswer))

    expect(build).toThrow(
      'case "index-exists" > mcpStub "tickets": no variant declares this MCP stub; pass the mcpStub("tickets") value to .mcpStub(...) on a variant',
    )
  })

  it("refuses case rules for a tool the variant's stub of that name lacks", () => {
    const otherPgsql = mcpStub("pgsql").tool("explain_query", (t) => t.returns("Seq Scan"))

    const build = () => suiteWithPgsql((c) => c.mcpStub(otherPgsql, (s) => s.on("explain_query").returns("Index Scan")).expect(anyAnswer))

    expect(build).toThrow(
      'case "index-exists" > variant "with-pgsql" > mcpStub "pgsql": no tool "explain_query"; declare it on the mcpStub("pgsql") the variant uses',
    )
  })

  it("refuses a stub and an MCP server of the same name in a variant", () => {
    const build = () =>
      suite("sql-review")
        .variant("with-pgsql", (v) =>
          v
            .mcpStub(pgsql)
            .mcpServers({ pgsql: { command: "pgsql-mcp" } })
            .prompt("Review change.diff"),
        )
        .case("index-exists", (c) => c.expect(anyAnswer))
        .toDefinition()

    expect(build).toThrow('variant "with-pgsql": "pgsql" is declared twice; rename one')
  })

  it("refuses a predicate as a matcher, which cannot cross to the stub process", () => {
    const isOrders = (input: unknown) => JSON.stringify(input).includes("orders")

    // @ts-expect-error a function is not a pattern
    const build = () => suiteWithPgsql((c) => c.mcpStub(pgsql, (s) => s.on("get_object_details", isOrders).returns({})).expect(anyAnswer))

    expect(build).toThrow(
      'case "index-exists" > mcpStub "pgsql" > get_object_details > rule 1: predicates cannot cross to the stub process; use an object pattern or a RegExp',
    )
  })

  it.each([
    [
      "an answer",
      mcpStub("pgsql").tool("list_objects", (t) => t.returns({ filter: { name: { $regex: "^ord" } } })),
      "list_objects > rule 1 > answer 1 > filter > name > $regex",
    ],
    [
      "an input pattern",
      mcpStub("pgsql").tool("list_objects", (t) => t.on({ filter: { $regex: "^ord" } }).returns([])),
      "list_objects > rule 1 > when > filter > $regex",
    ],
    [
      "an input schema",
      mcpStub("pgsql").tool("list_objects", (t) => t.inputSchema({ type: "object", $regex: "^ord" })),
      "list_objects > inputSchema > $regex",
    ],
  ])("refuses the key a RegExp crosses to the stub process under, in %s", (_, stub, path) => {
    const build = () =>
      suite("sql-review")
        .variant("with-pgsql", (v) => v.mcpStub(stub).prompt("Review change.diff"))
        .case("index-exists", (c) => c.expect(anyAnswer))
        .toDefinition()

    expect(build).toThrow(
      `variant "with-pgsql" > mcpStub "pgsql" > ${path}: the key "$regex" is reserved for RegExp serialization; rename it`,
    )
  })

  it("refuses a server name an agent cannot put in a tool name", () => {
    const spaced = mcpStub("pg sql").tool("list_instances", (t) => t.returns([]))

    const build = () =>
      suite("sql-review")
        .variant("with-pgsql", (v) => v.mcpStub(spaced).prompt("Review change.diff"))
        .case("index-exists", (c) => c.expect(anyAnswer))
        .toDefinition()

    expect(build).toThrow(
      'variant "with-pgsql" > mcpStub "pg sql": MCP stub and tool names may contain only letters, digits, "_" and "-": rename it',
    )
  })
})
