import type { ToolCall } from "../ports/agent.ts"
import { answerText, StubResponder } from "../ports/mcp-stub-rules.mjs"
import type { McpStubDefinition } from "../ports/mcp-stub.ts"

/**
 * The tool call an MCP stub of the run would have produced for `input`, with its `mcp` annotation: what a
 * `FakeAgentAdapter` reply reports to test graders without an agent. Answers as a fresh stub does: a rule with several
 * answers gives its first one. The call is named after the tool, since only an agent names MCP tools.
 *
 * @example
 * new FakeAgentAdapter({
 *   reply: (input) => ({ finalText: "done", toolCalls: [answerStub(input.mcpStubs, "pgsql", "get_object_details", { object_name: "orders" })] }),
 * })
 */
export function answerStub(stubs: readonly McpStubDefinition[], server: string, tool: string, input: unknown): ToolCall {
  const stub = stubs.find((candidate) => candidate.server === server)
  if (!stub) {
    const declared = stubs.map((candidate) => candidate.server).join(", ") || "none"
    throw new Error(
      `answerStub: no MCP stub "${server}" in this trial (declared: ${declared}); pass the mcpStub("${server}") value to .mcpStub(...) on the variant`,
    )
  }
  const { answer, answeredBy } = new StubResponder(stub).answer(tool, input)
  return { name: tool, input, output: answerText(answer), isError: answer.isError, mcp: { server, tool, answeredBy } }
}
