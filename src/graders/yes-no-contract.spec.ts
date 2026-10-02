import { describe, expect, it } from "vitest"
import { answerShape } from "./answer-shape.ts"
import { MAX_REASON_LENGTH, yesNoContract } from "./yes-no-contract.ts"
import { criteriaOf } from "#test/graders.ts"

describe("answerShape with yesNoContract", () => {
  const shape = async (text: string, options?: Parameters<typeof yesNoContract>[0]) =>
    (await criteriaOf(answerShape("f", yesNoContract(options)), { finalText: text }))[0]

  it('accepts "non" alone and "oui" then one line per reason', async () => {
    expect(await shape("non\n")).toEqual(["f", true, '"non" alone'])
    expect(await shape("oui\n- Migration de schéma : ajout de la colonne priority\n- Règle métier changée")).toEqual([
      "f",
      true,
      '"oui" then 2 reason line(s)',
    ])
  })

  it('rejects a "non" followed by anything, and a bare "oui"', async () => {
    expect(await shape("non\nStyle only.")).toEqual(["f", false, 'reasons: "non" must stand alone'])
    expect(await shape("oui")).toEqual(["f", false, 'reasons: "oui" must be followed by one line per reason'])
  })

  it("rejects a first line that is not the verdict word alone", async () => {
    expect(await shape("Style only.\nnon")).toEqual(["f", false, 'verdict: the first line must be "non" or "oui" alone'])
    expect(await shape("**Oui**\n- migration")).toEqual(["f", false, 'verdict: the first line must be "non" or "oui" alone'])
  })

  it("names each off-contract line: blank line, heading, confidence level, recommendation", async () => {
    expect(await shape("oui\n## Détails\n\nConfiance : haute\nÀ relire :\n- Je recommande une relecture")).toEqual([
      "f",
      false,
      'reasons[0]: heading "## Détails"; reasons[1]: blank line ""; reasons[2]: confidence level "Confiance : haute"; ' +
        'reasons[3]: heading "À relire :"; reasons[4]: recommendation "- Je recommande une relecture"',
    ])
  })

  it("anchors each filter on the shape of the line: a reason that names confidence or recommendation is a reason", async () => {
    const reasons = [
      "#1234 migration de la table outbox",
      "- abaisse le seuil de confiance des paiements partiels",
      "Tiers de confiance : nouvelle règle de validation",
      "Règle de recommandation de paiement modifiée",
    ]
    expect(await shape(`oui\n${reasons.join("\n")}`)).toEqual(["f", true, '"oui" then 4 reason line(s)'])
    for (const [line, label] of [
      ["confiance: haute", "confidence level"],
      ["**confiance: haute**", "confidence level"],
      ["- Confiance « moyenne » plutôt que « basse »", "confidence level"],
      ["Niveau de confiance élevé", "confidence level"],
      ["Recommandation : relire la migration", "recommendation"],
      ["Nous recommandons une relecture", "recommendation"],
      ["# Verdict", "heading"],
    ] as const) {
      expect((await shape(`oui\n${line}`))?.[2], line).toMatch(new RegExp(`^reasons\\[0\\]: ${label} `))
    }
  })

  it("rejects a paragraph: a reason line longer than maxReasonLength", async () => {
    const paragraph = `- ${"Le diff change la règle de dédoublonnage. ".repeat(12)}`.trimEnd()
    expect(paragraph.length).toBeGreaterThan(MAX_REASON_LENGTH)
    expect(await shape(`oui\n${paragraph}`)).toEqual([
      "f",
      false,
      `reasons[0]: paragraph of ${paragraph.length} characters, at most 500 per reason line`,
    ])
    expect((await shape("oui\n- une raison assez longue", { maxReasonLength: 10 }))?.[1]).toBe(false)
    expect(() => yesNoContract({ maxReasonLength: 0 })).toThrow("must be a positive integer")
  })

  it("restricts the verdicts a well-formed answer may carry", async () => {
    expect(await shape("oui\n- migration", { verdicts: ["no"] })).toEqual(["f", false, 'verdict: the first line must be "non" alone'])
    expect(await shape("yes\n- migration", { words: { yes: "yes", no: "no" } })).toEqual(["f", true, '"yes" then 1 reason line(s)'])
  })
})
