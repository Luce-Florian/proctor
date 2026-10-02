import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { describe, expect, it } from "vitest"
import { killProcessGroups, runProcess } from "./process.ts"
import { tempDir } from "#test/helpers.ts"

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Waits until `pid` is gone, at most `ms`; returns whether it is. */
async function gone(pid: number, ms: number) {
  for (const started = Date.now(); Date.now() - started < ms;) {
    if (!alive(pid)) return true
    await sleep(50)
  }
  return !alive(pid)
}

/** A shell that runs `before`, starts a grandchild ignoring SIGTERM, writes its pid to `pidFile`, then runs `then`. */
const withGrandchild = (pidFile: string, then: string, before = ":") => ({
  file: "/bin/sh",
  args: ["-c", `${before}; sh -c 'trap "" TERM; sleep 30' & echo $! > ${pidFile}; ${then}`],
})

const readPid = async (pidFile: string) => {
  for (let i = 0; i < 40; i++) {
    const pid = Number((await readFile(pidFile, "utf8").catch(() => "")).trim())
    if (pid > 0) return pid
    await sleep(25)
  }
  throw new Error(`no pid in ${pidFile}`)
}

describe("runProcess", () => {
  it("writes input to the command's stdin, then closes it", async () => {
    const input = `line 1\n${"é".repeat(300_000)}`

    const result = await runProcess({ file: "/bin/sh", args: ["-c", "wc -c"] }, { cwd: "/", env: { PATH: "/usr/bin:/bin" }, input })

    expect(Number(result.stdout.trim())).toBe(Buffer.byteLength(input))
  })

  it("does not fail when the command exits without reading its stdin", async () => {
    const result = await runProcess(
      { file: "/bin/sh", args: ["-c", "echo early"] },
      { cwd: "/", env: { PATH: "/usr/bin:/bin" }, input: "x".repeat(1_000_000) },
    )

    expect(result).toMatchObject({ code: 0, stdout: "early" })
  })

  it("returns once the command exits, killing what it left behind in the background", async () => {
    const pidFile = join(await tempDir(), "pid")
    const started = Date.now()

    // The grandchild keeps stdout open: without the group kill, "close" would wait for its 30 s.
    const result = await runProcess(withGrandchild(pidFile, "echo done"), { cwd: "/", env: { PATH: "/usr/bin:/bin" } })

    expect(result).toMatchObject({ code: 0, stdout: "done" })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(await gone(await readPid(pidFile), 2_000)).toBe(true)
  })

  it("on abort, terminates the whole group, then kills what ignores SIGTERM after the grace period", async () => {
    const pidFile = join(await tempDir(), "pid")
    const controller = new AbortController()
    // The trap is set before the pid is written, so the abort never lands before it.
    const stubborn = withGrandchild(pidFile, "wait", `trap "" TERM`)
    const running = runProcess(stubborn, { cwd: "/", env: { PATH: "/usr/bin:/bin" }, signal: controller.signal })
    const grandchild = await readPid(pidFile)
    const started = Date.now()

    controller.abort(new Error("stop"))

    await expect(running).rejects.toThrow("stop")
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900)
    expect(await gone(grandchild, 2_000)).toBe(true)
  }, 10_000)

  it("kills every running group at once, for a forced exit", async () => {
    const pidFile = join(await tempDir(), "pid")
    // Not `wait`: the group is not signalled atomically, and `wait` exits 0 if the grandchild dies before the shell.
    // Once `exec sleep` replaces the shell, a signal is the only way out.
    const running = runProcess(withGrandchild(pidFile, "exec sleep 30"), { cwd: "/", env: { PATH: "/usr/bin:/bin" } })
    const grandchild = await readPid(pidFile)

    killProcessGroups()

    expect((await running).code).toBeNull()
    expect(await gone(grandchild, 2_000)).toBe(true)
  })
})
