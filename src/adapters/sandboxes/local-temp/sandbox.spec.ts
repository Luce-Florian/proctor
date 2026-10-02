import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LocalTempSandbox } from "./sandbox.ts"
import { exists, sandboxSpec as spec } from "#test/adapters.ts"
import { tempDir } from "#test/helpers.ts"

const hostEnv = {
  PATH: "/Users/me/.claude/plugins/cache/x/bin:/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin",
  LANG: "fr_FR.UTF-8",
  HOME: "/Users/me",
  GH_TOKEN: "ghp_secret",
  AWS_PROFILE: "prod",
  SSH_AUTH_SOCK: "/tmp/ssh.sock",
}

describe("local-temp sandbox", () => {
  it("builds the agent environment from an allow-list, with temp HOME, TMPDIR and XDG_*", async () => {
    const sandbox = new LocalTempSandbox({ env: hostEnv, hostHome: "/Users/me", tmpRoot: await tempDir() })
    const ws = await sandbox.create(spec)

    expect(sandbox.isolation).toBe("degraded")
    expect(ws.env).toEqual({
      LANG: "fr_FR.UTF-8",
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      HOME: ws.home,
      TMPDIR: join(ws.home, "..", "tmp"),
      XDG_CONFIG_HOME: join(ws.home, ".config"),
      XDG_DATA_HOME: join(ws.home, ".local", "share"),
      XDG_STATE_HOME: join(ws.home, ".local", "state"),
      XDG_CACHE_HOME: join(ws.home, ".cache"),
    })
    expect(ws.wrap).toBeUndefined()
    expect(await exists(ws.cwd)).toBe(true)
  })

  it("removes the whole temp root on destroy", async () => {
    const sandbox = new LocalTempSandbox({ tmpRoot: await tempDir() })
    const ws = await sandbox.create(spec)

    await sandbox.destroy(ws)

    expect(await exists(join(ws.cwd, ".."))).toBe(false)
  })
})
