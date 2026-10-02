import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("temp layout", () => {
  it("keeps the root short, so srt socket paths under TMPDIR stay below the macOS 104-byte limit", async () => {
    const { allocateLayout, releaseLayout } = await import("./temp-layout.ts")
    const layout = await allocateLayout("dotnet-build-di-aggregator [baseline] #1")

    expect(Buffer.byteLength(join(layout.tmp, "srt-mux-99999-0.sock"))).toBeLessThanOrEqual(104)
    await releaseLayout(layout.root)
  })
})
