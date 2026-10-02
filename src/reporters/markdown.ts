import { aggregatesOf, extraOf, type Ablation, type GroupAggregate } from "./aggregates.ts"
import { duration, NONE, percent, points, score, signed, signedUsd, usd, usdMeanSd, type RenderOptions } from "./format.ts"
import { siblingPath, type CtrfSink } from "./ctrf.ts"
import type { CtrfReport, CtrfTest } from "./ctrf-types.ts"
import { writeTextFile } from "./files.ts"

/**
 * Renders a CTRF document as a markdown summary. Reads only the CTRF, so it also works on archived reports.
 *
 * @example
 * const markdown = renderMarkdown(JSON.parse(await readFile("run.ctrf.json", "utf8")))
 */
export function renderMarkdown(report: CtrfReport, options: RenderOptions = {}): string {
  const { summary, environment, tests } = report.results
  const agent = environment?.extra?.agent as { id?: string; version?: string } | undefined
  const sandbox = environment?.extra?.sandbox as { id?: string } | undefined
  const isolation = environment?.extra?.isolation as string | undefined
  const judge = environment?.extra?.judge as { id?: string; version?: string; model?: string } | undefined
  const suiteErrors = (report.results.extra?.suiteErrors ?? []) as string[]
  const { aggregates, ablation } = aggregatesOf(report, options.baseline)
  const provenance = [
    report.timestamp,
    environment?.commit && `commit \`${environment.commit}\``,
    agent?.id && `agent \`${agent.id}\` ${agent.version ?? ""}`.trim(),
    sandbox?.id && `sandbox \`${sandbox.id}\`${isolation ? ` (isolation \`${isolation}\`)` : ""}`,
    judge?.id && `judge \`${judge.id}\` ${judge.version ?? ""}${judge.model ? ` \`${judge.model}\`` : ""}`.trim(),
  ].filter(Boolean)

  return [
    `# ${environment?.reportName ?? "proctor"} — ${report.runId ?? "run"}`,
    "",
    provenance.join(" · "),
    "",
    "| Tests | Passed | Failed | Other | Skipped | Duration |",
    "|---|---|---|---|---|---|",
    `| ${summary.tests} | ${summary.passed} | ${summary.failed} | ${summary.other} | ${summary.skipped} | ${duration(summary.stop - summary.start)} |`,
    "",
    "| Case | Variant | Trial | Status | Criteria | Cost | Duration | Message |",
    "|---|---|---|---|---|---|---|---|",
    ...tests.map(row),
    "",
    "## Aggregates",
    "",
    "| Case | Variant | Passed | Criteria | Decoys | Principal | Score | Cost | Judge |",
    "|---|---|---|---|---|---|---|---|---|",
    ...aggregates.groups.map(groupRow),
    "",
    `Judge: ${aggregates.judge.calls} call(s), ${usd(aggregates.judge.costUsd)}, not counted in the costs above.`,
    "",
    ...(ablation.length > 0
      ? [
          `## Ablation vs \`${aggregates.baseline}\``,
          "",
          "| Case | Variant | Δ criteria | Δ score | Δ cost | Δ pass rate |",
          "|---|---|---|---|---|---|",
          ...ablation.map(ablationRow),
          "",
        ]
      : []),
    ...suiteErrors.map((e) => `**Suite error:** ${e}\n`),
  ].join("\n")
}

function row(test: CtrfTest): string {
  const [, caseId = test.name, variant = ""] = test.suite ?? []
  const extra = extraOf(test)
  const criteria = extra.criteria ?? []
  const met = criteria.filter((c) => c.met).length
  const cost = typeof extra.costUsd === "number" && extra.costUsd > 0 ? usd(extra.costUsd) : NONE
  const cells = [
    caseId,
    variant,
    String(test.labels?.trial ?? ""),
    test.status,
    criteria.length > 0 ? `${met}/${criteria.length}` : NONE,
    cost,
    duration(test.duration),
    test.message ?? "",
  ]
  return `| ${cells.map(escape).join(" | ")} |`
}

function groupRow(g: GroupAggregate): string {
  const cells = [
    g.caseId,
    g.variant,
    `${g.passed}/${g.trials}`,
    percent(g.criteria),
    percent(g.decoys),
    g.principal ? `${g.principal.met}/${g.principal.of}` : NONE,
    score(g),
    usdMeanSd(g.costUsd),
    g.judgeCalls > 0 ? `${g.judgeCalls} × ${usd(g.judgeCostUsd)}` : NONE,
  ]
  return `| ${cells.map(escape).join(" | ")} |`
}

function ablationRow(a: Ablation): string {
  const cells = [
    a.caseId,
    a.variant,
    points(a.criteria),
    signed(a.score, 2),
    signedUsd(a.costUsd),
    a.passRate === undefined ? NONE : `${signed(a.passRate * 100, 0)} pts`,
  ]
  return `| ${cells.map(escape).join(" | ")} |`
}

const escape = (cell: string) => cell.replaceAll("|", "\\|").replace(/\r\n|\r|\n/g, " ")

/**
 * Writes the markdown summary of a CTRF document and returns its path.
 *
 * @example
 * await writeMarkdownSummary(report, "results/hello/<runId>.summary.md")
 */
export function writeMarkdownSummary(report: CtrfReport, path: string, options: RenderOptions = {}): Promise<string> {
  return writeTextFile(path, renderMarkdown(report, options))
}

/**
 * The summary of a CTRF file: same directory, same run id, so each run keeps its own summary.
 *
 * @example
 * summaryPath("results/hello/<runId>.ctrf.json") // "results/hello/<runId>.summary.md"
 */
export const summaryPath = (ctrfFile: string): string => siblingPath(ctrfFile, ".summary.md")

/**
 * CTRF sink writing `<runId>.summary.md` next to the `.ctrf.json`.
 *
 * @example
 * new CtrfReporter({ outDir: "results", toolVersion, sinks: [markdownSummary] })
 */
export const markdownSummary: CtrfSink = (report, ctrfFile) => writeMarkdownSummary(report, summaryPath(ctrfFile))
