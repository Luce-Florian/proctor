import { access, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AgentRunInput, Workspace } from "@fluce/proctor"
import type { ClaudeAuthProfile } from "../../src/adapters/agents/claude-code/credentials.ts"
import { StreamCollector } from "../../src/adapters/agents/claude-code/stream-parser.ts"
import type { Credential } from "../../src/auth/credential-resolver.ts"
import { fixturePath, tempWorkspace } from "./helpers.ts"

/** A recorded `claude -p --output-format stream-json` run, under test/fixtures/stream-json/. */
export const stream = (name: string) => fixturePath("stream-json", `${name}.jsonl`)
/** A stand-in for the claude binary, driven by the FAKE_CLAUDE_* variables of {@link fakeWorkspace}. */
export const fakeClaude = fixturePath("fake-claude.sh")
export const oauth: Credential<ClaudeAuthProfile> = { profile: "oauth", variable: "CLAUDE_CODE_OAUTH_TOKEN", value: "fake-oauth-token" }

/** Feeds a recorded stream to a collector, line by line. */
export async function collect(name: string) {
  const collector = new StreamCollector()
  for (const line of (await readFile(stream(name), "utf8")).split("\n")) collector.add(line)
  return collector
}

export const input = (patch: Partial<AgentRunInput> = {}): AgentRunInput => ({
  prompt: "say ok",
  plugins: [],
  mcpServers: {},
  mcpStubs: [],
  permissions: "readonly",
  settings: {},
  signal: new AbortController().signal,
  ...patch,
})

/** A workspace whose environment drives test/fixtures/fake-claude.sh. */
export async function fakeWorkspace(streamName: string, extra: Record<string, string> = {}): Promise<Workspace & { record: string }> {
  const workspace = await tempWorkspace()
  // Next to work/ and home/, out of the agent's view.
  const record = join(dirname(workspace.cwd), "record")
  return {
    ...workspace,
    record,
    env: { PATH: "/usr/bin:/bin", FAKE_CLAUDE_STREAM: stream(streamName), FAKE_CLAUDE_RECORD: record, ...extra },
  }
}

export const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/** What a trial asks of a sandbox, with access to grant. */
export const sandboxSpec = {
  label: "review [baseline] #1",
  access: { allowedDomains: ["api.anthropic.com"], readablePaths: ["/opt/claude"], writablePaths: ["/tmp/.dotnet"] },
}
