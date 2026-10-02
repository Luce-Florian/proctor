# Yes/no answers

Three levels grade a skill that answers yes or no: the verdict, the shape, then the meaning of the reason lines.

| Level | Grader | Cost |
|---|---|---|
| verdict, principal | `verdictEquals(id, "yes" \| ["no", "yes"])` | free |
| shape | `answerShape(id, yesNoContract())` | free |
| meaning of the reason lines | `judge().criterion(...)`, gated with `.when(verdictIs("yes"))` when `non` is also valid | one judge call |

See the `migration` and `split-controller` cases in [Graders](./graders.md) for a full example.

## `verdictEquals`

- Passes when the first line of the answer (surrounding blanks, BOM and CRLF aside) is **exactly** the expected word: `oui`/`non` by default, case-sensitive.
- `**Non.**`, `NON` or a verdict on line 3 are not a verdict.
- Its criterion is **principal**. It checks the verdict only, not the shape.

## `yesNoContract`

`yesNoContract()` reads the answer as `{ verdict, reasons }` (1st line, following lines), then validates it with zod:

| Answer | `met` | `why` |
|---|---|---|
| `non` | ✓ | `"non" alone` |
| `oui\n- Migration DDL sur outbox` | ✓ | `"oui" then 1 reason line(s)` |
| `non\nStyle only.` | ✗ | `reasons: "non" must stand alone` |
| `oui` | ✗ | `reasons: "oui" must be followed by one line per reason` |
| `**Oui**\n- …`, `review: oui` | ✗ | `verdict: the first line must be "non" or "oui" alone` |
| `oui\n## Détails\n\nConfiance : haute` | ✗ | `reasons[0]: heading "## Détails"; reasons[1]: blank line ""; reasons[2]: confidence level …` |
| a line longer than 500 characters | ✗ | `reasons[0]: paragraph of 612 characters, at most 500 per reason line` |

- Heading: a line that starts with `#` followed by a blank (`#1234 migration` is a reason) or ends with `:`.
- Confidence: a line that **starts** with `confiance`/`niveau de confiance`/`confidence`, bullets and `**` aside (`confiance: haute`, `- Confiance « moyenne »…`).
- Recommendation: a line that starts with `Recommandation :` or `Je/Nous recommande…`, `I/We recommend…`.
- A word in the middle of a line does not count: `- abaisse le seuil de confiance…`, `Tiers de confiance : …`, `Règle de recommandation de paiement modifiée` are reasons.

## Options

- The defaults are specific to `/sdlc:check-if-need-humain-review` (French words and filters, 500 characters). Another yes/no skill overrides `words` and `maxReasonLength`; another format writes its own contract.
- 500 characters (`MAX_REASON_LENGTH`): 9 reason lines out of 10 in recorded bash runs are below it. Beyond that, the line explains or chains several patterns.
- `verdicts: ["no"]` restricts the well-formed verdicts: it means "the output is strictly `non`".
- Another format = another contract `{ parse, schema, describe? }`, without touching `answerShape`.

## Gating the judge

- A judge whose `.when()` gate is closed costs no call. It returns a passing grade **without criteria**: see [Not applicable](./graders.md#not-applicable). The trial then has no score: the aggregates say over how many graded trials the score is averaged (`0.75 ± 0.10 (2/4)`).
- Put a gate on what makes the criteria irrelevant, not on the expected verdict. On a case that expects `oui`, `.when(verdictIs("yes"))` would leave a wrong `non` without a score. Hence `split-controller` in [Graders](./graders.md), where `non` is valid.
- `verdictIs("yes")` follows the same strict rule as `verdictEquals`. Any `(result) => boolean` function also works.
