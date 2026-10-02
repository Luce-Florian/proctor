import { execFile } from "node:child_process"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { beforeEach, describe, expect, it } from "vitest"
import { InterruptedError } from "@fluce/proctor"
import { main } from "../src/cli/main.ts"
import { ctrfErrors } from "#test/ctrf-schema.ts"
import { fixturePath, tempDir } from "#test/helpers.ts"

const root = new URL("..", import.meta.url).pathname
const hello = join(root, "examples/hello.eval.ts")
const fixture = (name: string) => fixturePath("suites", name)

let out: string
beforeEach(async () => {
  out = await tempDir()
})

/** Runs the CLI with an empty environment: no credential ever comes from the host. */
async function cli(...argv: string[]) {
  return cliWith({}, ...argv)
}

async function cliWith(extra: { signal?: AbortSignal }, ...argv: string[]) {
  const stdout: string[] = []
  const stderr: string[] = []
  const code = await main(argv, {
    stdout: { write: (s: string) => stdout.push(s) },
    stderr: { write: (s: string) => stderr.push(s) },
    env: {},
    ...extra,
  })
  return { code, stdout: stdout.join(""), stderr: stderr.join("") }
}

async function ctrfFile(suite: string) {
  const [file] = (await readdir(join(out, suite))).filter((f) => f.endsWith(".ctrf.json"))
  return join(out, suite, file ?? "missing.ctrf.json")
}

const readCtrf = async (suite: string) => JSON.parse(await readFile(await ctrfFile(suite), "utf8"))

describe("proctor run", () => {
  it("runs examples/hello.eval.ts with --agent fake: exit 0, valid CTRF and <runId>.summary.md", async () => {
    const { code, stdout } = await cli("run", hello, "--agent", "fake", "--out", out)

    expect(code).toBe(0)
    expect(stdout).toContain("PASS  greets-world [baseline] #1")
    const ctrf = await ctrfFile("hello")
    const report = await readCtrf("hello")
    expect(ctrfErrors(report)).toEqual([])
    expect(report.results.summary).toMatchObject({ tests: 2, passed: 2 })
    expect(report.results.environment.extra).toMatchObject({ sandbox: { id: "fake" }, isolation: "none" })
    const summaryFile = ctrf.replace(/\.ctrf\.json$/, ".summary.md")
    const summary = await readFile(summaryFile, "utf8")
    expect(summary).toContain("| greets-world | polite | 1 | passed | 2/2 |")
    expect(summary).toContain("(isolation `none`)")
    expect(stdout).toContain(`Wrote ${ctrf}\nWrote ${summaryFile}\n`)
  })

  it("judges with a fake when the agent is fake, and warns about a judge that pins no model", async () => {
    const { stdout } = await cli("run", fixture("judged.eval.ts"), "--agent", "fake", "--out", out)

    const report = await readCtrf("judged")
    expect(report.results.environment.extra.judge).toMatchObject({ id: "fake", sandbox: { id: "fake" } })
    expect(stdout).toContain(
      "Warning: 1 judge() grader(s) pin no model and --judge-model is not set: the judge runs on the default model of fake, " +
        'recorded as judgeModel "unpinned (<model>)". Pin one with judge().model(...) or --judge-model.',
    )
    const quiet = await cli("run", fixture("judged.eval.ts"), "--agent", "fake", "--out", out, "--judge-model", "m")
    expect(quiet.stdout).not.toContain("Warning")
  })

  it("instantiates no judge for a suite without judge(), and writes the --report formats with aggregates and ablation", async () => {
    const { code, stdout } = await cli("run", hello, "--agent", "fake", "--out", out, "--report", "markdown,html", "--baseline", "polite")

    expect(code).toBe(0)
    const report = await readCtrf("hello")
    expect(report.results.environment.extra.judge).toBeUndefined()
    expect(stdout).not.toContain("Warning")
    expect(report.results.extra.aggregates).toMatchObject({ baseline: "polite", judge: { calls: 0, costUsd: 0 } })
    expect(report.results.extra.ablation).toEqual([
      expect.objectContaining({ caseId: "greets-world", variant: "baseline", baseline: "polite", criteria: 0 }),
    ])
    expect(stdout).toMatch(/Wrote .*\.ctrf\.json\nWrote .*\.summary\.md\nWrote .*\.report\.html\n/)
  })

  it("keeps one summary per run", async () => {
    await cli("run", hello, "--agent", "fake", "--out", out)
    await cli("run", hello, "--agent", "fake", "--out", out)

    const files = await readdir(join(out, "hello"))
    expect(files.filter((f) => f.endsWith(".summary.md"))).toHaveLength(2)
  })

  it("--repeat 3 -j 2 writes 3 trials per variant in matrix order", async () => {
    const { code } = await cli("run", hello, "--agent", "fake", "--out", out, "--repeat", "3", "-j", "2")

    expect(code).toBe(0)
    const report = await readCtrf("hello")
    expect(report.results.tests.map((t: { name: string }) => t.name)).toEqual([
      "greets-world [baseline] #1",
      "greets-world [baseline] #2",
      "greets-world [baseline] #3",
      "greets-world [polite] #1",
      "greets-world [polite] #2",
      "greets-world [polite] #3",
    ])
  })

  it("filters with --case and --variant", async () => {
    await cli("run", hello, "--agent", "fake", "--out", out, "--variant", "polite", "--case", "greets-world")

    const report = await readCtrf("hello")
    expect(report.results.tests.map((t: { name: string }) => t.name)).toEqual(["greets-world [polite] #1"])
  })

  it("accepts filters before the file, repeated or comma-separated", async () => {
    const { code } = await cli("run", "--case", "greets-world", "--variant", "polite,baseline", hello, "--agent", "fake", "--out", out)

    expect(code).toBe(0)
    const report = await readCtrf("hello")
    expect(report.results.tests).toHaveLength(2)
  })

  it("accepts a repeated --variant", async () => {
    await cli("run", hello, "--variant", "polite", "--variant", "baseline", "--agent", "fake", "--out", out)

    expect((await readCtrf("hello")).results.tests).toHaveLength(2)
  })

  it("exits 1 when an evaluation fails", async () => {
    const { code, stdout } = await cli("run", fixture("failing.eval.ts"), "--agent", "fake", "--out", out)

    expect(code).toBe(1)
    expect(stdout).toContain("FAIL  says-goodbye [baseline] #1")
  })

  it("exits 2 on an infrastructure error, and still writes the report", async () => {
    const { code } = await cli("run", fixture("broken.eval.ts"), "--agent", "fake", "--out", out)

    expect(code).toBe(2)
    const report = await readCtrf("broken")
    expect(report.results.tests[0]).toMatchObject({ status: "other" })
    expect(report.results.tests[0].message).toMatch(/is not a directory/)
  })

  it("an interrupted run exits 2 and still writes the report, every trial other", async () => {
    const interrupt = new AbortController()
    interrupt.abort(new InterruptedError("SIGINT"))

    const { code } = await cliWith({ signal: interrupt.signal }, "run", hello, "--agent", "fake", "--out", out)

    expect(code).toBe(2)
    const report = await readCtrf("hello")
    expect(report.results.tests.map((t: { status: string; message: string }) => [t.status, t.message])).toEqual([
      ["other", "interrupted by SIGINT: cleanups ran, the remaining trials were not started"],
      ["other", "interrupted by SIGINT: cleanups ran, the remaining trials were not started"],
    ])
  })

  it.each([
    [["run", hello, "--agent", "nope"], 'Unknown agent "nope". Available: fake, claude-code'],
    [["run", hello, "--agent", "toString"], 'Unknown agent "toString". Available: fake, claude-code'],
    [["run", hello, "--agent", "fake", "--report", "constructor"], 'Unknown report format "constructor". Available: markdown, html'],
    [["run", hello, "--agent", "fake", "--sandbox", "nope"], 'Unknown sandbox "nope". Available: fake, local-temp, srt'],
    [
      ["run", hello, "--agent", "claude-code"],
      "No credential for claude-code: run `claude setup-token` and export the token as CLAUDE_CODE_OAUTH_TOKEN",
    ],
    [
      ["run", hello, "--agent", "claude-code", "--auth", "api-key"],
      "--auth api-key: profile api-key (ANTHROPIC_API_KEY) is not validated yet",
    ],
    [["run", "missing.eval.ts", "--agent", "fake"], "Check the path: a relative path is resolved from the current directory"],
    [["run", fixture("no-default.eval.ts"), "--agent", "fake"], 'has no default export: add `export default suite("name")'],
    [["run", "suite.yaml", "--agent", "fake"], "Cannot load"],
    [["run", hello, "--agent", "fake", "--repeat", "0"], "--repeat must be a positive integer"],
  ])("exits 2 with an actionable message for %j", async (argv, message) => {
    const { code, stderr } = await cli(...argv, "--out", out)

    expect(code).toBe(2)
    expect(stderr).toContain(message)
  })
})

describe("sandbox selection", () => {
  it("reports isolation degraded, with a warning, under --sandbox local-temp", async () => {
    const { code, stdout } = await cli("run", hello, "--agent", "fake", "--sandbox", "local-temp", "--out", out)

    expect(code).toBe(0)
    expect(stdout).toContain("Warning: sandbox local-temp only isolates the configuration")
    expect((await readCtrf("hello")).results.environment.extra).toMatchObject({ sandbox: { id: "local-temp" }, isolation: "degraded" })
  })
})

describe("proctor report", () => {
  it("regenerates the summary from a CTRF file", async () => {
    await cli("run", hello, "--agent", "fake", "--out", out)
    const ctrf = await ctrfFile("hello")
    const target = join(out, "regenerated.md")

    const { code } = await cli("report", ctrf, "--output", target)

    expect(code).toBe(0)
    expect(await readFile(target, "utf8")).toBe(await readFile(ctrf.replace(/\.ctrf\.json$/, ".summary.md"), "utf8"))
  })

  it("--format html writes the HTML report next to the CTRF file", async () => {
    await cli("run", hello, "--agent", "fake", "--out", out)
    const ctrf = await ctrfFile("hello")

    const { code, stdout } = await cli("report", ctrf, "--format", "html")

    const html = ctrf.replace(/\.ctrf\.json$/, ".report.html")
    expect(code).toBe(0)
    expect(stdout).toBe(`Report: ${html}\n`)
    expect(await readFile(html, "utf8")).toContain("<h2>greets-world</h2>")
  })

  it("--baseline recomputes the ablation against another variant", async () => {
    await cli("run", hello, "--agent", "fake", "--out", out)
    const ctrf = await ctrfFile("hello")
    const target = join(out, "vs-polite.md")

    const { code } = await cli("report", ctrf, "--baseline", "polite", "--output", target)

    expect(code).toBe(0)
    expect(await readFile(target, "utf8")).toContain("## Ablation vs `polite`\n\n| Case | Variant |")
    expect(await readFile(target, "utf8")).toContain("| greets-world | baseline |")
  })

  it("rejects an unknown format, listing the known ones", async () => {
    const { code, stderr } = await cli("report", join(out, "x.ctrf.json"), "--format", "pdf")

    expect(code).toBe(2)
    expect(stderr).toContain('Unknown report format "pdf". Available: markdown, html')
  })

  it("rejects a file that is not CTRF", async () => {
    const file = join(out, "not-ctrf.json")
    await writeFile(file, "{}")

    const { code, stderr } = await cli("report", file)

    expect(code).toBe(2)
    expect(stderr).toContain("is not a CTRF report")
  })

  it("rejects a CTRF file whose fields do not have the types the reports print", async () => {
    await cli("run", hello, "--agent", "fake", "--out", out)
    const ctrf = await ctrfFile("hello")
    const report = JSON.parse(await readFile(ctrf, "utf8"))
    report.results.summary.passed = "<img src=x onerror=alert(1)>"
    report.results.tests[0].extra.turns = "<script>alert(1)</script>"
    await writeFile(ctrf, JSON.stringify(report))

    const { code, stderr } = await cli("report", ctrf, "--format", "html")

    expect(code).toBe(2)
    expect(stderr).toContain("is not a valid CTRF report")
    expect(stderr).toContain("results.summary.passed")
    expect(stderr).toContain("results.tests[0].extra.turns")
  })
})

describe("proctor list", () => {
  it("lists variants and cases", async () => {
    const { code, stdout } = await cli("list", hello)

    expect(code).toBe(0)
    expect(stdout).toContain("hello")
    expect(stdout).toContain("variants: baseline, polite")
    expect(stdout).toContain("greets-world — The agent greets the world")
  })
})

describe("bin/proctor.js", () => {
  it("runs the example end to end through tsx", async () => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [join(root, "bin/proctor.js"), "run", "examples/hello.eval.ts", "--agent", "fake", "--out", out],
      { cwd: root },
    )

    expect(stdout).toContain("2 trials: 2 passed")
    expect(ctrfErrors(await readCtrf("hello"))).toEqual([])
  })
})
