# Legacy loader

`proctor run <theme-dir>` reads a theme in the legacy bash bench format without modifying it:

```sh
npx proctor run <legacy-theme> --agent claude-code -j 2
```

| Bash bench | Harness |
|---|---|
| `cases/*.json`: `repo`, `diff_file`, `diff_apply`, `overlay_dir` | `gitRepo(...)` fixture |
| `prompt`, a string or an object per variant | the variant's prompt; missing key: trial `other` |
| `expected.criteria` of a yes/no case | `verdictEquals`, `answerShape`, judge on `oui`: see [yes/no themes](#yes-no-themes-in-three-levels) |
| `expected.criteria` of other cases | `judge()` with model `claude-sonnet-5`, ids `c01`…, `[principal]` and `[leurre]` detected, `diff_file` given to the judge |
| `variants/*/settings.json` | settings, `__REPO_ROOT__` (two levels above the theme directory) resolved, model pinned from `settings.model`; under srt, a referenced directory becomes readable as is, a script through its directory, never a parent (at suite level) |
| `variants/*/plugins` | directory plugins `<repo>/marketplace/plugins/<name>`, resolved to absolute paths at load time |
| `initialize.sh`: `claude plugin marketplace add` + `install` | marketplace plugins installed in the sandbox home |
| `cleanup.sh`: `uninstall`, `marketplace remove` | nothing: the sandbox home is thrown away |
| any other line in these scripts | rejected at load time, with the advice to port the variant to `*.eval.ts` |
| `--permission-mode bypassPermissions` | permissions `full` |
| no timeout | `30m` |

## Yes/no themes in three levels

The legacy loader recognizes a case's yes/no contract from its criteria, without modifying the theme's files (`src/loaders/legacy-verdicts.ts`). The criteria texts below are the legacy data format, matched literally:

| Legacy criterion | Role | Graded by |
|---|---|---|
| `Rend le verdict "non"…` | verdict, **principal** | `verdictEquals(id, verdict)` |
| `La sortie est strictement "non"…`, `La sortie est "oui" suivi uniquement d'une ligne par pattern…`, `Aucun texte hors du contrat…` | shape | `answerShape(id, yesNoContract({ verdicts }))`, with the verdicts the case accepts |
| `S'il répond "non", la sortie est … ; s'il répond "oui" …, la sortie est …` | shape, both verdicts accepted | same |
| `Une des lignes identifie une migration…`, `S'il répond "oui", aucune ligne ne prétend…` | meaning of the reason lines | `judge()` `claude-sonnet-5`, the case's diff, **principal** criterion, `.minScore(1)`; `.when(verdictIs("yes"))` only if `non` is also accepted |

| Case | Graders | Judge calls |
|---|---|---|
| a case that expects `non` (verdict + shape) | `c01`, `c02` | 0 |
| a case that expects `oui` | `c01`, `c02`, `judge` (`c03`) | 1, whatever the answer: a wrong `non` is judged (`c03` missed), as in the bash bench |
| a case that accepts both verdicts | `verdict` (added, principal), `c01`, `c03`, `judge` (`c02`) | 1 if the agent answers `oui`, 0 on `non` |

- Legacy ids `c01`… and texts are kept. The judge runtime is created once per run, as soon as a case in the run has a judge (even if no answer calls it: its credential is then required and `environment.judge` reported). The judge **call**, however, only happens if its gate is open.
- Passed = all graded criteria met: each semantic criterion is principal and the score does not count (`minScore(1)`), so `oui\nxyz` fails on `c03`, as in the bash bench, which judged everything.
- Closed gate (a valid `non` on a case that accepts both): `c02` is absent from the trial, neither met nor missed. The aggregates report the share of criteria met per trial, so a perfect `non` (3 criteria) and a perfect `oui` (4) both count as 100%.
- Intended differences from the legacy `judge.sh`, which graded everything with the judge: the criteria counts differ, not the passed/failed verdict. On a case that accepts both verdicts, `c01` and `c03` are two identical `answerShape` (two legacy shape criteria): a shape defect counts twice. Under `non`, `c02`, "held" vacuously by the bash bench, is omitted.
- A case with no recognized verdict criterion keeps the judge for all its criteria.

A legacy theme whose tool writes outside the trial or restores packages from a registry has no parity under srt: see [Known limitations](../limitations.md), and [port it](./porting.md).
