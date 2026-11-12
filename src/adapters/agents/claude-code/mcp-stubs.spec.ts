import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { claudeStubName, pluginServers, stubToolParser, type ClaudeStub } from "./mcp-stubs.ts"
import { tempDir } from "#test/helpers.ts"

/** A plugin directory holding the given files, relative path to content. */
async function pluginDir(files: Record<string, string>): Promise<string> {
  const dir = await tempDir()
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return dir
}

describe("pluginServers", () => {
  it("reads the plugin name from its manifest and the servers its .mcp.json declares", async () => {
    const dir = await pluginDir({
      ".claude-plugin/plugin.json": '{ "name": "dbtools", "version": "1.0.0" }',
      ".mcp.json": '{ "mcpServers": { "pgsql": { "type": "http", "url": "https://pgsql.example.com/mcp" } } }',
    })

    expect(await pluginServers(dir, "0-dbtools")).toEqual({ plugin: "dbtools", servers: ["pgsql"] })
  })

  it("reads the servers its manifest declares inline", async () => {
    const dir = await pluginDir({
      ".claude-plugin/plugin.json": '{ "name": "dbtools", "mcpServers": { "pgsql": { "command": "pgsql-mcp" } } }',
    })

    expect((await pluginServers(dir, "dbtools")).servers).toEqual(["pgsql"])
  })

  it.each([
    ["a path", '"./config/mcp.json"'],
    ["a list of paths", '["./config/mcp.json"]'],
  ])("reads the servers of the file its manifest points to with %s", async (_, mcpServers) => {
    const dir = await pluginDir({
      ".claude-plugin/plugin.json": `{ "name": "dbtools", "mcpServers": ${mcpServers} }`,
      "config/mcp.json": '{ "mcpServers": { "pgsql": { "command": "pgsql-mcp" } } }',
    })

    expect((await pluginServers(dir, "dbtools")).servers).toEqual(["pgsql"])
  })

  it("reads the servers of .mcp.json and of its manifest together, each name once", async () => {
    const dir = await pluginDir({
      ".claude-plugin/plugin.json": '{ "name": "dbtools", "mcpServers": { "pgsql": {}, "tickets": {} } }',
      ".mcp.json": '{ "mcpServers": { "grafana": {}, "pgsql": {} } }',
    })

    expect((await pluginServers(dir, "dbtools")).servers).toEqual(["grafana", "pgsql", "tickets"])
  })

  it("names a plugin without manifest after its directory, and finds no server without .mcp.json", async () => {
    expect(await pluginServers(await pluginDir({}), "dbtools")).toEqual({ plugin: "dbtools", servers: [] })
  })
})

describe("claudeStubName", () => {
  it("keeps the stub's name when no loaded plugin declares a server of that name", () => {
    expect(claudeStubName("pgsql", [{ plugin: "sdlc", servers: ["grafana"] }])).toBe("pgsql")
  })

  it("names the stub after the server of the loaded plugin it replaces", () => {
    expect(claudeStubName("pgsql", [{ plugin: "dbtools", servers: ["pgsql"] }])).toBe("plugin:dbtools:pgsql")
  })

  it("refuses a server two loaded plugins declare", () => {
    const plugins = [
      { plugin: "dbtools", servers: ["pgsql"] },
      { plugin: "dba", servers: ["pgsql"] },
    ]

    expect(() => claudeStubName("pgsql", plugins)).toThrow(
      'mcpStub "pgsql": plugins "dbtools" and "dba" both declare this server; load only one',
    )
  })
})

describe("stubToolParser", () => {
  const stub = (name: string, server: string): ClaudeStub => ({ name, entry: { name: server, command: "node", args: [], tools: [] } })

  it("reads the stub's own name and the tool from a tool of the server Claude Code named after a plugin", () => {
    const parse = stubToolParser([stub("plugin:dbtools:pgsql", "pgsql")])

    expect(parse("mcp__plugin_dbtools_pgsql__get_object_details")).toEqual({ server: "pgsql", tool: "get_object_details" })
  })

  it("reads nothing from a tool no stub serves", () => {
    const parse = stubToolParser([stub("pgsql", "pgsql")])

    expect(parse("Read")).toBeUndefined()
  })

  it("gives a tool name to the stub with the longest matching server name", () => {
    const parse = stubToolParser([stub("db", "db"), stub("db__prod", "db__prod")])

    expect(parse("mcp__db__prod__list")).toEqual({ server: "db__prod", tool: "list" })
  })
})
