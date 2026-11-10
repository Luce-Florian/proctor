# MCP stubs

A skill that reads an MCP server (a database, a ticket tracker) cannot be measured on a diff alone: the server does not exist in the trial. An MCP stub is a fake server, declared in the suite, that answers what the case says it would.

```ts
// examples/mcp-stub.eval.ts
import { mcpCalled, mcpError, mcpStub, regex, suite } from "@fluce/proctor"

/** The server as the agent sees it: copy descriptions and input schemas from the real server's tools/list. */
const pgsql = mcpStub("pgsql").tool("get_object_details", (t) =>
  t
    .description("Columns, nullability, constraints and indexes of a table.")
    .inputSchema({ type: "object", properties: { object_name: { type: "string" } }, required: ["object_name"] })
    .otherwise(mcpError("relation does not exist")),
)

const QUESTION = "Does the table orders need an index on customer_id? Answer yes or no, then why."

export default suite("mcp-stub")
  .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt(QUESTION))
  .variant("without-server", (v) => v.prompt(QUESTION))
  .case("index-exists", (c) =>
    c
      .description("The server reports an index on orders(customer_id)")
      .mcpStub(pgsql, (s) =>
        s
          .on("get_object_details", { object_name: /^(public\.)?orders$/ })
          .returns({ table: "public.orders", indexes: ["orders_pkey (id)", "orders_customer_id_idx (customer_id)"] }),
      )
      .expect(mcpCalled("reads-orders", pgsql, { tool: "get_object_details", input: { object_name: /^(public\.)?orders$/ } }))
      .expect(mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 }))
      .expect(regex("answers-yes-or-no", /\b(yes|no)\b/i)),
  )
```

```mermaid
sequenceDiagram
    participant H as harness (host)
    participant A as agent, in the sandbox
    participant M as node stub-server.mjs (pgsql)
    Note over H: prepare: stub program, its rules and pgsql.json in <trial home>/.proctor/mcp/
    H->>A: run, with pgsql declared as a stdio MCP server
    A->>M: spawn, initialize, tools/list
    A->>M: tools/call get_object_details {object_name: "orders"}
    M-->>A: first matching rule, else a fallback
    M->>M: append the call and what answered it to pgsql.jsonl
    A-->>H: tool calls, final answer
    Note over H: the log proves the stub served; each call it answered gets ToolCall.mcp
```

## Where each piece lives

| What | Level | Rule |
|---|---|---|
| Tools, descriptions, input schemas | the `mcpStub()` value | one catalog, shared; a case cannot add a tool |
| Answers shared by every case | the `mcpStub()` value: `t.returns(...)`, `t.on(...)` | e.g. `list_instances` always answers `prod` |
| The server exists in the trial | variant: `v.mcpStub(pgsql)` | a variant without it runs without the server: two variants measure the skill with and without it |
| Answers of one case | case: `c.mcpStub(pgsql, s => …)` | apply only in the variants that declare `pgsql` |
| Fallback | `t.otherwise(...)`, else `mcpStub().otherwise(...)` | built in: a tool error, `No result for these arguments.` |

A call `(tool, input)` gets the first match of:

1. the case rules for that tool, in declaration order;
2. the rules of the `mcpStub()` value for that tool, in declaration order;
3. the tool's `otherwise`, then the server's, then the built-in fallback.

## Matching an input

| `when` | Matches | Example |
|---|---|---|
| omitted | any input | `.on("list_instances")` |
| object pattern | every key of the pattern is in the input and matches, recursively; extra input keys are ignored | `{ object_name: "orders" }` |
| `RegExp` as a value | a string field it matches | `{ object_name: /^(public\.)?orders$/i }` |
| array as a value | same length, element by element | `{ columns: ["customer_id"] }` |
| `RegExp` as `when` | the JSON of the whole input | `.on("execute_sql", /reltuples/)` |

The `input` of `mcpCalled` takes the same patterns. A function cannot cross to the stub process: the types refuse it, and the suite refuses it at load time.

## Answers

| Call | The agent receives |
|---|---|
| `.returns("text")` | the text |
| `.returns({ … })`, an array, a number, a boolean | the value as pretty JSON text |
| `.returns(mcpError("text"))` | the text as a tool error (`isError: true`) |
| `.returnsInOrder(a, b, mcpError("c"))` | `a`, then `b`, then `c` for every later matching call |

A large answer, an `EXPLAIN` plan for instance, is read by the suite itself: `.returns(await readFile(new URL("./plan.txt", import.meta.url), "utf8"))`.

## Grading the calls

| Need | Grader |
|---|---|
| the agent called a tool | `mcpCalled("reads-orders", pgsql, { tool: "get_object_details" })` |
| … with a given input | `{ tool, input: { object_name: /^(public\.)?orders$/ } }` |
| … a number of times | `mcpCalled(…, { min, max })` |
| the agent asked nothing the case did not anticipate | `mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 })` |

- In a variant without the stub, `mcpCalled` is not applicable: no criterion, so the variant without the server is measured by the other graders, not failed by construction.
- The judge sees the answer and the diff, never the tool calls: state in the criterion what the stub answers ("`get_object_details` reports an index on `orders(customer_id)`").
- `toolUsed` still works on the agent's own names, e.g. `mcp__pgsql__get_object_details` for Claude Code.

## Run and report

| Where | What |
|---|---|
| `proctor list` | `with-pgsql  mcp stubs: pgsql (1 tool)` |
| `--agent fake --sandbox srt` | starts each stub through the sandbox, for free; the fake agent calls no tool |
| CTRF | `mcpStubCalls`, `mcpStubFallbacks` per trial, never an input or an answer ([CTRF reference](../running/ctrf.md)) |
| summary, HTML, console | a note on each trial where a fallback answered: the case may need a rule |
| tests | `answerStub(input.mcpStubs, "pgsql", tool, input)` from `@fluce/proctor/testing` gives a `FakeAgentAdapter` the call a stub would have produced |

How an agent runs the stubs: [Claude Code](../agents/claude-code/index.md) (flags), [Claude Code: plugins](../agents/claude-code/plugins.md#mcp-servers-of-a-plugin) (a stub replaces a plugin's server), [Extending](../contributing/extending.md#mcp-stubs-in-a-new-agent) (another agent).
