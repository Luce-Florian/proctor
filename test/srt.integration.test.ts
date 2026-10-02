/**
 * Runs the real `srt` CLI on shell commands, without LLM nor network: the policy srtSettings() writes must
 * actually deny reads outside the trial and writes outside the workspace. Skipped where srt cannot run.
 */
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { platform } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { NO_ACCESS, type Workspace } from "@fluce/proctor"
import { runProcess, which } from "../src/adapters/process.ts"
import { SrtSandbox } from "../src/adapters/sandboxes/srt/sandbox.ts"
import { tempDir } from "#test/helpers.ts"

/** Why srt cannot run here, or undefined when it can. */
function unavailable(): string | undefined {
  const path = process.env.PATH ?? ""
  if (platform() === "darwin") return existsSync("/usr/bin/sandbox-exec") && which("rg", path) ? undefined : "needs sandbox-exec and rg"
  if (platform() === "linux") return ["bwrap", "socat", "rg"].every((tool) => which(tool, path)) ? undefined : "needs bwrap, socat and rg"
  return `srt does not support ${platform()}`
}

const reason = unavailable()
/** Seatbelt refuses the access; bubblewrap hides a denied directory behind an empty one. */
const denial = platform() === "darwin" ? /Operation not permitted/ : /No such file|Operation not permitted|Read-only/
if (reason) console.warn(`Skipping the srt integration test: ${reason}.`)

// A host-home stand-in outside every temp dir, so that only the home rule can hide it.
const packageDir = new URL("..", import.meta.url).pathname
const fakeHome = await mkdtemp(join(packageDir, "node_modules", ".srt-test-home-"))
afterAll(() => rm(fakeHome, { recursive: true, force: true }))

/** Runs `script` with sh inside the workspace sandbox; resolves with the exit code and output. */
async function sh(ws: Workspace, script: string) {
  const command = ws.wrap?.({ file: "/bin/sh", args: ["-c", script] })
  if (!command) throw new Error("srt workspace without wrap")
  const result = await runProcess(command, { cwd: ws.cwd, env: ws.env, signal: AbortSignal.timeout(30_000) })
  return { code: result.code, output: `${result.stdout}\n${result.stderr}` }
}

describe.skipIf(reason !== undefined)("srt sandbox, real srt CLI", () => {
  it("denies the host home, another trial, writes outside the workspace; allows the workspace and declared paths", async () => {
    await writeFile(join(fakeHome, "id_ed25519"), "PRIVATE KEY")
    const tmpRoot = await tempDir()
    const writable = join(await tempDir(), "tool-cache")
    await mkdir(writable)
    const outside = await tempDir()
    const sandbox = new SrtSandbox({ hostHome: fakeHome, tmpRoot })
    const access = { ...NO_ACCESS, writablePaths: [writable] }
    const [ws, other] = [await sandbox.create({ label: "srt a", access }), await sandbox.create({ label: "srt b", access })]
    await writeFile(join(other.cwd, "other-trial.txt"), "other trial output")
    try {
      const home = await sh(ws, `cat ${join(fakeHome, "id_ed25519")}`)
      expect(home.code).not.toBe(0)
      expect(home.output).not.toContain("PRIVATE KEY")
      expect(home.output).toMatch(denial)

      const otherTrial = await sh(ws, `cat ${join(other.cwd, "other-trial.txt")}`)
      expect(otherTrial.code).not.toBe(0)
      expect(otherTrial.output).not.toContain("other trial output")
      expect(otherTrial.output).toMatch(denial)

      const escape = await sh(ws, `echo x > ${join(outside, "escaped.txt")}`)
      expect(escape.code).not.toBe(0)
      expect(escape.output).toMatch(denial)
      expect(existsSync(join(outside, "escaped.txt"))).toBe(false)

      const inside = await sh(ws, "echo inside > probe.txt && cat probe.txt && echo home > $HOME/h && echo tmp > $TMPDIR/t")
      expect(inside).toMatchObject({ code: 0, output: expect.stringContaining("inside") })

      const declared = await sh(ws, `echo cache > ${join(writable, "c")} && cat ${join(writable, "c")}`)
      expect(declared).toMatchObject({ code: 0, output: expect.stringContaining("cache") })

      // The Claude adapter sends the prompt on stdin: srt must hand it to the command whole.
      const prompt = `/sdlc:review 'x'\n${"é".repeat(100_000)}`
      const command = ws.wrap?.({ file: "/bin/sh", args: ["-c", "wc -c"] })
      const piped = command && (await runProcess(command, { cwd: ws.cwd, env: ws.env, input: prompt, signal: AbortSignal.timeout(30_000) }))
      expect(Number(piped?.stdout.trim())).toBe(Buffer.byteLength(prompt))
    } finally {
      await sandbox.destroy(ws)
      await sandbox.destroy(other)
    }
  }, 60_000)
})
