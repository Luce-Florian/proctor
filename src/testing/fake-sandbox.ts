import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Sandbox, SandboxSpec } from "../ports/sandbox.ts"
import type { Workspace } from "../ports/workspace.ts"

/**
 * Sandbox for tests and `--agent fake`: a throw-away temp directory, with no isolation at all.
 * Records what it created and destroyed so tests can check the teardown.
 *
 * @example
 * const sandbox = new FakeSandbox()
 * await runSuite(definition, { agent: new FakeAgentAdapter(), sandbox })
 * sandbox.live // 0: every workspace was destroyed
 */
export class FakeSandbox implements Sandbox {
  readonly id = "fake"
  readonly isolation = "none"
  readonly created: Workspace[] = []
  /** Specs received by `create`, in call order. */
  readonly specs: SandboxSpec[] = []
  readonly destroyed: Workspace[] = []

  /** Workspaces created and not destroyed yet. */
  get live(): number {
    return this.created.length - this.destroyed.length
  }

  /** @example const ws = await sandbox.create({ label: "hello [baseline] #1", access: NO_ACCESS }) */
  async create(spec: SandboxSpec): Promise<Workspace> {
    this.specs.push(spec)
    const root = await mkdtemp(join(tmpdir(), "proctor-fake-"))
    const workspace: Workspace = { cwd: join(root, "work"), home: join(root, "home"), env: {} }
    await Promise.all([mkdir(workspace.cwd), mkdir(workspace.home)])
    this.created.push(workspace)
    return workspace
  }

  /** @example await sandbox.destroy(ws) */
  async destroy(workspace: Workspace): Promise<void> {
    await rm(join(workspace.cwd, ".."), { recursive: true, force: true })
    this.destroyed.push(workspace)
  }
}
