import { cp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runSuite, toCtrf } from "@fluce/proctor"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { loadSuite } from "../src/loaders/index.ts"
import { ctrfErrors } from "#test/ctrf-schema.ts"
import { fixturePath, tempDir } from "#test/helpers.ts"

const fixtures = fixturePath()
const demo = join(fixtures, "legacy", "demo")
const context = { id: "greet", context: "" }

describe("legacy JSON loader", () => {
  it("maps variants: prompt per variant, pinned model, plugins, resolved __REPO_ROOT__, bypass permissions", async () => {
    const definition = await loadSuite(demo)
    const [baseline, withTool] = definition.variants

    expect(definition.name).toBe("demo")
    expect(baseline).toMatchObject({ name: "baseline", model: "claude-sonnet-5", plugins: [], permissions: "full" })
    expect(baseline?.prompt(context)).toBe("say hi")
    expect(withTool?.prompt(context)).toBe("/tool:greet say hi")
    expect(withTool?.plugins).toEqual([join(fixtures, "marketplace", "plugins", "demo-plugin"), "tool@owner/tool"])
    expect(JSON.stringify(withTool?.settings)).toContain(`"command":"${join(fixtures, "marketplace/plugins/demo-plugin/hooks/patch.sh")}"`)
    expect(definition.sandboxAccess.readablePaths).toEqual([join(fixtures, "marketplace", "plugins", "demo-plugin", "hooks")])
  })

  it("makes a referenced directory readable as is, never its parent", async () => {
    const theme = join(await tempDir(), "evals", "dirs")
    await cp(demo, theme, { recursive: true })
    await cp(join(fixtures, "marketplace"), join(theme, "..", "..", "marketplace"), { recursive: true })
    const settings = { env: { PLUGIN: "__REPO_ROOT__/marketplace/plugins/demo-plugin", ROOT: "__REPO_ROOT__" } }
    await writeFile(join(theme, "variants", "baseline", "settings.json"), JSON.stringify(settings))

    const definition = await loadSuite(theme)

    const repo = join(theme, "..", "..")
    expect(definition.sandboxAccess.readablePaths).toEqual(
      expect.arrayContaining([join(repo, "marketplace", "plugins", "demo-plugin"), repo]),
    )
    expect(definition.sandboxAccess.readablePaths).not.toContain(join(repo, "marketplace", "plugins"))
    expect(definition.sandboxAccess.readablePaths).not.toContain(join(repo, ".."))
  })

  it("judges each case on the run's judge, with stable ids, principal and decoys flagged by their prefix", async () => {
    const definition = await loadSuite(demo)
    const answer =
      '{"score": 5, "criteria": [{"id": "c03", "met": true, "why": "c"}, {"id": "c01", "met": true, "why": "a"}, {"id": "c02", "met": true, "why": "b"}]}'
    const judge = new FakeAgentAdapter({ id: "judge", reply: () => answer })
    const agent = new FakeAgentAdapter({ reply: () => "hi" })

    const run = await runSuite(definition, { agent, sandbox: new FakeSandbox(), judge: { agent: judge, sandbox: new FakeSandbox() } })

    expect(run.trials.map((t) => t.status)).toEqual(["passed", "passed"])
    expect(run.trials[0]?.grades[0]?.criteria.map((c) => [c.id, c.principal ?? false, c.decoy ?? false])).toEqual([
      ["c01", true, false],
      ["c02", false, false],
      ["c03", false, true],
    ])
    expect(agent.calls.every((c) => c.permissions === "full")).toBe(true)
    expect(judge.calls[0]).toMatchObject({ permissions: "readonly", model: "claude-sonnet-5" })
    expect(judge.calls[0]?.prompt).toContain('{"id":"c01","type":"principal","text":"Says hi"}')
  })

  it('grades a yes/no case in three tiers; a wrong "non" is judged too, so it keeps a score, and the CTRF stays valid', async () => {
    const theme = join(await tempDir(), "evals", "verdicts")
    await cp(demo, theme, { recursive: true })
    await cp(join(fixtures, "marketplace"), join(theme, "..", "..", "marketplace"), { recursive: true })
    const criteria = [
      'Rend le verdict "oui"',
      'La sortie est "oui" suivi uniquement d\'une ligne par pattern identifié : pas de sections',
      "Une des lignes identifie une migration",
    ]
    await writeFile(join(theme, "cases", "greet.json"), JSON.stringify({ id: "greet", prompt: "review", expected: { criteria } }))
    const definition = await loadSuite(theme)
    const runWith = async (answer: string, judged: string) => {
      const judge = new FakeAgentAdapter({ id: "judge", reply: () => judged })
      const run = await runSuite(definition, {
        agent: new FakeAgentAdapter({ reply: () => answer }),
        sandbox: new FakeSandbox(),
        judge: { agent: judge, sandbox: new FakeSandbox() },
      })
      return { run, judge }
    }
    const missed = '{"score": 1, "criteria": [{"id": "c03", "met": false, "why": "no migration named"}]}'

    const yes = await runWith(
      "oui\n- migration de schéma : ajout d'une colonne",
      '{"score": 5, "criteria": [{"id": "c03", "met": true, "why": "DDL"}]}',
    )
    const xyz = await runWith("oui\nxyz", missed)
    const no = await runWith("non", missed)

    expect(yes.judge.calls).toHaveLength(2)
    expect(yes.judge.calls[0]).toMatchObject({ permissions: "readonly", model: "claude-sonnet-5" })
    expect(yes.run.trials.map((t) => t.status)).toEqual(["passed", "passed"])
    expect(yes.run.trials[0]?.grades.flatMap((g) => g.criteria.map((c) => [g.graderId, c.id, c.met, c.principal ?? false]))).toEqual([
      ["c01", "c01", true, true],
      ["c02", "c02", true, false],
      ["judge", "c03", true, true],
    ])
    // The bash bench read the reason; so does the judge: "oui\nxyz" no longer passes.
    expect(xyz.run.trials.map((t) => t.status)).toEqual(["failed", "failed"])
    expect(xyz.run.trials[0]?.message).toBe("Unmet criteria: c03 (principal)")
    // "oui" expected: a "non" has no reason line, the judge says c03 is missed, as judge.sh did. No omission to reward it.
    expect(no.judge.calls).toHaveLength(2)
    expect(no.run.trials[0]?.message).toBe("Unmet criteria: c01 (principal), c02, c03 (principal)")
    expect(toCtrf(no.run, { toolVersion: "0" }).results.tests[0]?.extra).toMatchObject({ score: 0, judgeCalls: 1 })
    for (const { run } of [yes, xyz, no]) expect(ctrfErrors(toCtrf(run, { toolVersion: "0" }))).toEqual([])
  })

  it('leaves the judge out of a valid "non" where either verdict is acceptable (pr379): not applicable, not missed', async () => {
    const theme = join(await tempDir(), "evals", "either")
    await cp(demo, theme, { recursive: true })
    await cp(join(fixtures, "marketplace"), join(theme, "..", "..", "marketplace"), { recursive: true })
    const criteria = [
      'S\'il répond "non", la sortie est strictement "non", rien d\'autre ; s\'il répond "oui" par prudence, la sortie est "oui" suivi uniquement d\'une ligne par pattern identifié',
      'S\'il répond "oui", aucune ligne ne prétend que les routes changent',
    ]
    await writeFile(join(theme, "cases", "greet.json"), JSON.stringify({ id: "greet", prompt: "review", expected: { criteria } }))
    const judge = new FakeAgentAdapter({ id: "judge", reply: () => "unused" })
    const run = await runSuite(await loadSuite(theme), {
      agent: new FakeAgentAdapter({ reply: () => "non" }),
      sandbox: new FakeSandbox(),
      judge: { agent: judge, sandbox: new FakeSandbox() },
    })

    expect(judge.calls).toHaveLength(0)
    expect(run.trials.map((t) => t.status)).toEqual(["passed", "passed"])
    expect(run.trials[0]?.grades.flatMap((g) => g.criteria.map((c) => c.id))).toEqual(["verdict", "c01"])
    const ctrf = toCtrf(run, { toolVersion: "0" })
    expect(ctrf.results.tests[0]?.extra?.judgeCalls).toBeUndefined()
    expect(ctrfErrors(ctrf)).toEqual([])
  })

  it("rejects an initialize.sh it cannot translate, saying how to port the variant", async () => {
    const theme = join(await tempDir(), "evals", "broken")
    await cp(demo, theme, { recursive: true })
    await cp(join(fixtures, "marketplace"), join(theme, "..", "..", "marketplace"), { recursive: true })
    await writeFile(join(theme, "variants", "baseline", "initialize.sh"), "#!/usr/bin/env bash\nnpm install -g something\n")

    await expect(loadSuite(theme)).rejects.toThrow('runs "npm install -g something": the legacy loader only understands claude plugin')
  })

  it("fails a trial whose case has no prompt for the variant, as run.sh does", async () => {
    const theme = join(await tempDir(), "evals", "partial")
    await cp(demo, theme, { recursive: true })
    await cp(join(fixtures, "marketplace"), join(theme, "..", "..", "marketplace"), { recursive: true })
    await writeFile(
      join(theme, "cases", "greet.json"),
      JSON.stringify({ id: "greet", prompt: { baseline: "hi" }, expected: { criteria: ["x"] } }),
    )

    const run = await runSuite(await loadSuite(theme), { agent: new FakeAgentAdapter(), sandbox: new FakeSandbox() })

    expect(run.trials[1]).toMatchObject({
      status: "other",
      message: expect.stringContaining('case "greet" has no prompt for variant "with-tool"'),
    })
  })
})
