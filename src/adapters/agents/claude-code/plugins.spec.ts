import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parsePluginRef } from "./plugins.ts"
import { tempDir } from "#test/helpers.ts"

describe("plugin references", () => {
  it.each([
    ["/repo/marketplace/plugins/sdlc", { kind: "directory", source: "/repo/marketplace/plugins/sdlc" }],
    ["caveman@JuliusBrussee/caveman", { kind: "marketplace", plugin: "caveman", marketplace: "JuliusBrussee/caveman" }],
  ])("reads %s", (ref, expected) => {
    expect(parsePluginRef(ref)).toEqual(expected)
  })

  it("resolves a bare name against the plugin roots, first match wins", async () => {
    const [first, second] = [await tempDir(), await tempDir()]
    await mkdir(join(second, "sdlc"))

    expect(parsePluginRef("sdlc", [first, second])).toEqual({ kind: "directory", source: join(second, "sdlc") })
  })

  it("says where it looked for a bare name, and how to point it elsewhere", async () => {
    const root = await tempDir()

    expect(() => parsePluginRef("sdlc")).toThrow('Plugin "sdlc" not found: no plugin root is configured. Pass --plugin-root <dir>')
    expect(() => parsePluginRef("sdlc", [root])).toThrow(`Plugin "sdlc" not found under ${root}. Pass --plugin-root <dir>`)
    expect(() => parsePluginRef("../x")).toThrow('Plugin "../x" is neither a name, an absolute directory nor <plugin>@<marketplace source>')
  })
})
