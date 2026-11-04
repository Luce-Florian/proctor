import { describe, expect, it } from "vitest"
import { srtSettings } from "./config.ts"
import { sandboxSpec as spec } from "#test/adapters.ts"

describe("srt sandbox", () => {
  const layout = { root: "/tmp/r", cwd: "/tmp/r/work", home: "/tmp/r/home", tmp: "/tmp/r/tmp" }

  it("hides the host home and shared temp dirs but the trial dirs, writes in the trial and declared paths only", () => {
    expect(srtSettings(layout, spec.access, { home: "/Users/me", sharedTemp: ["/tmp", "/Volumes"] })).toEqual({
      network: { allowedDomains: ["api.anthropic.com"], deniedDomains: [] },
      filesystem: {
        denyRead: ["/Users/me", "/tmp", "/Volumes"],
        allowRead: ["/tmp/r/work", "/tmp/r/home", "/tmp/r/tmp", "/tmp/.dotnet", "/opt/claude"],
        allowWrite: ["/tmp/r/work", "/tmp/r/home", "/tmp/r/tmp", "/tmp/.dotnet"],
        denyWrite: [],
      },
    })
  })

  it("re-allows no parent of a writable path, such as the trial root: on Linux it would bury that path read-only", () => {
    const { allowRead, allowWrite } = srtSettings(layout, spec.access, { home: "/Users/me", sharedTemp: ["/tmp"] }).filesystem
    const parents = allowRead.filter((read) => allowWrite.some((write) => write.startsWith(`${read}/`)))
    expect(parents).toEqual([])
  })
})
