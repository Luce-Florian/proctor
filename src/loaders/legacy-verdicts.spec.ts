import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FakeAgentAdapter, FakeSandbox } from "@fluce/proctor/testing"
import { judge, Judge } from "../graders/llm-judge.ts"
import { classify, verdictGraders } from "./legacy-verdicts.ts"
import { gradeContext } from "#test/helpers.ts"

describe("legacy yes/no cases", () => {
  const base = judge().model("claude-sonnet-5")

  it("recognises the yes/no contract of every check-human-review case", () => {
    expect(classify(['Rend le verdict "non"', 'La sortie est strictement "non", rien d\'autre'])).toEqual({
      accepted: ["no"],
      roles: ["verdict", "format"],
    })
    expect(
      classify([
        'S\'il répond "non", la sortie est strictement "non", rien d\'autre ; s\'il répond "oui" par prudence sur la zone autorisation, la sortie est "oui" suivi uniquement d\'une ligne par pattern identifié',
        'S\'il répond "oui", aucune ligne ne prétend que les routes changent',
        "Aucun texte hors du contrat : pas de niveau de confiance",
      ]),
    ).toEqual({ accepted: ["no", "yes"], roles: ["format", "semantic", "format"] })
    expect(classify(["Répond clairement oui, le module a une gestion des permissions"])).toBeUndefined()
  })

  const casesDir = new URL("../../../check-human-review/cases/", import.meta.url).pathname
  it.skipIf(!existsSync(casesDir))(
    'maps the 10 real cases: verdict, shape, and a judge gated on "oui" only where "non" is valid too',
    async () => {
      const files = (await readdir(casesDir)).filter((f) => f.endsWith(".json")).sort()
      expect(files).toHaveLength(10)
      const tiers: Record<string, string[]> = {}
      const graded: Record<string, Record<string, { ids: string[]; calls: number; passes: boolean }>> = {}
      for (const file of files) {
        const legacy = JSON.parse(await readFile(join(casesDir, file), "utf8")) as { id: string; expected: { criteria: string[] } }
        const graders = verdictGraders(legacy.expected.criteria, base) ?? []
        tiers[legacy.id] = graders.map((g) =>
          g instanceof Judge ? `judge${g.usesJudge.model === "claude-sonnet-5" ? "" : ":unpinned"}` : g.id,
        )
        const semantic = (classify(legacy.expected.criteria)?.roles ?? []).flatMap((role, i) => (role === "semantic" ? [`c0${i + 1}`] : []))
        // A judge that finds every reason line right: what is graded, and how often it is asked, is what this test pins.
        const reply = JSON.stringify({ score: 5, criteria: semantic.map((id) => ({ id, met: true, why: "ok" })) })
        const byAnswer: (typeof graded)[string] = (graded[legacy.id] = {})
        for (const [name, answer] of [
          ["non", "non"],
          ["oui", "oui\n- Migration de schéma : ajout de la colonne priority"],
        ] as const) {
          const judgeRuntime = { agent: new FakeAgentAdapter({ id: "judge", reply: () => reply }), sandbox: new FakeSandbox() }
          const grades = await Promise.all(graders.map((g) => g.grade(gradeContext({ finalText: answer }, { judge: judgeRuntime }))))
          const criteria = grades.flatMap((g) => g.criteria)
          expect(
            criteria.some((c) => c.principal),
            `${legacy.id} ${name}`,
          ).toBe(true)
          byAnswer[name] = {
            ids: criteria.map((c) => `${c.id}${c.principal ? "!" : ""}`),
            calls: judgeRuntime.agent.calls.length,
            passes: grades.every((g) => g.passed && g.criteria.every((c) => c.met || !c.principal)),
          }
        }
      }
      const nonOnly = ["c01", "c02"]
      const yesCase = ["c01", "c02", "judge"]
      expect(tiers).toEqual({
        "non-css-largeur-tooltip-pr2827": nonOnly,
        "non-css-padding-drawer-pr2914": nonOnly,
        "non-refacto-code-mort-port-pr2410": nonOnly,
        "non-refacto-massif-var-usings-pr1442": nonOnly,
        "non-refacto-split-controller-authz-pr379": ["verdict", "c01", "c03", "judge"],
        "oui-domaine-ecart-ttc-import-pdf-pr2886": yesCase,
        "oui-domaine-idempotence-acompte-pr1458": yesCase,
        "oui-domaine-matching-paiements-partiels-pr2574": yesCase,
        "oui-migration-add-column-outbox-pr1356": yesCase,
        "oui-migration-backfill-index-uniques-pr507": yesCase,
      })
      const pureNo = { non: { ids: ["c01!", "c02"], calls: 0, passes: true }, oui: { ids: ["c01!", "c02"], calls: 0, passes: false } }
      // "oui" expected: a "non" is judged too (1 call), so the wrong verdict keeps the judge's score.
      const pureYes = {
        non: { ids: ["c01!", "c02", "c03!"], calls: 1, passes: false },
        oui: { ids: ["c01!", "c02", "c03!"], calls: 1, passes: true },
      }
      expect(graded).toEqual({
        "non-css-largeur-tooltip-pr2827": pureNo,
        "non-css-padding-drawer-pr2914": pureNo,
        "non-refacto-code-mort-port-pr2410": pureNo,
        "non-refacto-massif-var-usings-pr1442": pureNo,
        // Either verdict is valid: on "non" the judge of the reason lines is not applicable, c02 is left out.
        "non-refacto-split-controller-authz-pr379": {
          non: { ids: ["verdict!", "c01", "c03"], calls: 0, passes: true },
          oui: { ids: ["verdict!", "c01", "c03", "c02!"], calls: 1, passes: true },
        },
        "oui-domaine-ecart-ttc-import-pdf-pr2886": pureYes,
        "oui-domaine-idempotence-acompte-pr1458": pureYes,
        "oui-domaine-matching-paiements-partiels-pr2574": pureYes,
        "oui-migration-add-column-outbox-pr1356": pureYes,
        "oui-migration-backfill-index-uniques-pr507": pureYes,
      })
    },
  )

  const pr379 = [
    'S\'il répond "non", la sortie est strictement "non", rien d\'autre ; s\'il répond "oui" par prudence sur la zone autorisation, la sortie est "oui" suivi uniquement d\'une ligne par pattern identifié',
    'S\'il répond "oui", aucune ligne ne prétend que les routes changent',
  ]

  it("keeps the verdict as a principal criterion when no legacy criterion states it (pr379)", async () => {
    const graders = verdictGraders(pr379, base) ?? []
    const grades = await Promise.all(graders.map((g) => g.grade(gradeContext({ finalText: "I cannot tell" }))))

    expect(grades.flatMap((g) => g.criteria).map((c) => [c.id, c.met, c.principal ?? false])).toEqual([
      ["verdict", false, true],
      ["c01", false, false],
    ])
  })

  it('asks the judge on "oui", every semantic criterion principal: a reason it rejects fails the trial', async () => {
    const graders = verdictGraders(pr379, base) ?? []
    const judgeAgent = new FakeAgentAdapter({
      id: "judge",
      reply: () => '{"score": 2, "criteria": [{"id": "c02", "met": false, "why": "claims the routes change"}]}',
    })
    const judgeRuntime = { agent: judgeAgent, sandbox: new FakeSandbox() }

    const grades = await Promise.all(
      graders.map((g) => g.grade(gradeContext({ finalText: "oui\n- les routes changent" }, { judge: judgeRuntime }))),
    )

    expect(judgeAgent.calls).toHaveLength(1)
    expect(judgeAgent.calls[0]?.prompt).toContain('{"id":"c02","type":"principal"')
    expect(grades.map((g) => [g.graderId, g.passed])).toEqual([
      ["verdict", true],
      ["c01", true],
      ["judge", false],
    ])
  })
})
