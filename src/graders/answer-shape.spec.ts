import { describe, expect, it } from "vitest"
import { z } from "zod"
import { answerShape } from "./answer-shape.ts"
import { criteriaOf } from "#test/graders.ts"

describe("answerShape", () => {
  it("is generic: any contract, a throwing parse misses the criterion", async () => {
    const contract = { parse: (text: string): unknown => JSON.parse(text), schema: z.object({ ok: z.literal(true) }) }
    expect(await criteriaOf(answerShape("j", contract), { finalText: '{"ok": true}' })).toEqual([
      ["j", true, "the answer matches its contract"],
    ])
    expect((await criteriaOf(answerShape("j", contract), { finalText: "nope" }))[0]?.[2]).toMatch(/^the answer cannot be read: /)
    expect((await criteriaOf(answerShape("j", contract), { finalText: '{"ok": false}' }))[0]?.[2]).toMatch(/^ok: /)
  })
})
