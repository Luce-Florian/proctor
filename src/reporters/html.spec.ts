import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { htmlReport, renderHtml } from "./html.ts"
import { report, tests, trial } from "#test/reports.ts"
import { tempDir } from "#test/helpers.ts"

describe("HTML report", () => {
  const html = renderHtml({
    ...report,
    results: {
      ...report.results,
      tests: [...tests, trial("baseline", 3, [false], {}, "failed")].map((t, i) =>
        i === 0 ? { ...t, message: "</script><script>alert(1)</script>" } : t,
      ),
    },
  })

  it("is one self-contained page: no request but the optional Google Fonts stylesheet", () => {
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    expect(urls.every((url) => url?.startsWith("https://fonts.googleapis.com"))).toBe(true)
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain("prefers-color-scheme: dark")
    expect(html).toContain('ui-monospace, "SF Mono", Menlo, monospace')
  })

  it("shows the summary, the variants with mean ± sd, the ablation and the criteria heatmap", () => {
    expect(html).toContain("judge cost (4 calls)")
    expect(html).toContain("<h3>with-sdlc</h3>")
    expect(html).toContain("<dt>Criteria</dt><dd>100% ± 0</dd>")
    expect(html).toContain("ablation · with-sdlc vs baseline")
    expect(html).toContain('<dt>Criteria</dt><dd class="up">+67 pts</dd>')
    expect(html).toContain('<span class="crit-id">c01</span><span class="tag principal">principal</span>')
    expect(html).toContain('<span class="tag">decoy</span>')
    expect(html).toContain('<span class="cell na" title="not graded">—</span>')
    expect(html).toContain("1 trial with an infrastructure error, left out of the means")
  })

  it("escapes everything that comes from the run", () => {
    expect(html).not.toContain("<script>alert(1)")
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html.match(/<script>/g)).toHaveLength(1)
  })

  it("is written next to the CTRF file by the htmlReport sink", async () => {
    const dir = await tempDir()
    const path = await htmlReport(report, join(dir, "run-7.ctrf.json"))

    expect(path).toBe(join(dir, "run-7.report.html"))
    expect(await readFile(path, "utf8")).toBe(renderHtml(report))
  })
})
