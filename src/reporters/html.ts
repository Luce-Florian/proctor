import { aggregatesOf, extraOf, groupOf, type Ablation, type GroupAggregate } from "./aggregates.ts"
import { siblingPath, type CtrfSink } from "./ctrf.ts"
import type { CtrfReport, CtrfTest } from "./ctrf-types.ts"
import { writeTextFile } from "./files.ts"
import { duration, NONE, percent, points, score, signed, signedUsd, usd, usdMeanSd, type RenderOptions } from "./format.ts"

const caseOf = (test: CtrfTest) => groupOf(test).caseId
const variantOf = (test: CtrfTest) => groupOf(test).variant

/** Escapes text for HTML content and attribute values. */
const esc = (value: unknown) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch)
/** A gain is green, a loss red; for a cost, the other way round. */
function trend(value: number | undefined, lowerIsBetter = false): "" | "up" | "down" {
  if (value === undefined || value === 0) return ""
  return value > 0 !== lowerIsBetter ? "up" : "down"
}

const STATUSES = ["passed", "failed", "other", "skipped"] as const

function header(report: CtrfReport): string {
  const env = report.results.environment
  const extra = (env?.extra ?? {}) as {
    agent?: { id?: string; version?: string; details?: Record<string, string> }
    sandbox?: { id?: string }
    isolation?: string
    judge?: { id?: string; version?: string; model?: string }
  }
  const models = [...new Set(report.results.tests.map((t) => extraOf(t).model).filter(Boolean))]
  const chips = [
    ["run", report.runId],
    ["date", report.timestamp],
    ["commit", env?.commit?.slice(0, 12)],
    ["branch", env?.branchName],
    ["agent", extra.agent && `${extra.agent.id} ${extra.agent.version ?? ""}`.trim()],
    ["model", models.join(", ")],
    ["sandbox", extra.sandbox?.id && `${extra.sandbox.id}${extra.isolation ? ` (${extra.isolation})` : ""}`],
    ["auth", extra.agent?.details?.auth],
    ["judge", extra.judge && `${extra.judge.id} ${extra.judge.version ?? ""}${extra.judge.model ? ` · ${extra.judge.model}` : ""}`.trim()],
  ].filter(([, v]) => v)
  return `<header>
  <span class="eyebrow">proctor · CTRF report</span>
  <h1>Suite ${esc(env?.reportName ?? "proctor")}</h1>
  <div class="chips">${chips.map(([k, v]) => `<span class="chip"><b>${esc(k)}</b>${esc(v)}</span>`).join("")}</div>
</header>`
}

function summary(report: CtrfReport, judgeCost: number, judgeCalls: number): string {
  const { summary: sum, tests } = report.results
  const cost = tests.reduce((a, t) => a + (extraOf(t).costUsd ?? 0), 0)
  const counts = STATUSES.map(
    (s) => `<div class="count"><span class="v num">${esc(sum[s])}</span><span class="k"><span class="dot ${s}"></span>${s}</span></div>`,
  ).join("")
  const bar = STATUSES.filter((s) => sum[s] > 0)
    .map((s) => `<span class="${s}" style="width:${esc((sum[s] / Math.max(1, sum.tests)) * 100)}%"></span>`)
    .join("")
  return `<section>
  <h2>Summary</h2>
  <div class="panel summary">
    <div class="counts">${counts}
      <div class="count"><span class="v num">${esc(usd(cost))}</span><span class="k">agent cost</span></div>
      <div class="count"><span class="v num">${esc(usd(judgeCost))}</span><span class="k">judge cost (${esc(judgeCalls)} call${judgeCalls > 1 ? "s" : ""})</span></div>
      <div class="count"><span class="v num">${esc(duration(sum.stop - sum.start))}</span><span class="k">run duration</span></div>
    </div>
    <div class="bar" aria-hidden="true">${bar}</div>
  </div>
</section>`
}

function variantCard(g: GroupAggregate): string {
  const graded = g.passed + g.failed
  const rows = [
    ["Passed trials", `${g.passed} / ${g.trials}`],
    ["Criteria", percent(g.criteria)],
    ["Decoys", percent(g.decoys)],
    ["Principal met", g.principal ? `${g.principal.met} / ${g.principal.of}` : NONE],
    ["Score (0–1)", score(g)],
    ["Mean cost", usdMeanSd(g.costUsd)],
    ["Mean duration", duration(g.durationMs?.mean)],
    ["Judge", g.judgeCalls > 0 ? `${g.judgeCalls} call${g.judgeCalls > 1 ? "s" : ""}, ${usd(g.judgeCostUsd)}` : "no call"],
  ]
  const excluded = g.trials - graded - g.skipped
  return `<div class="panel variant">
    <h3>${esc(g.variant)}</h3>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    ${excluded > 0 ? `<span class="msg">${excluded} trial${excluded > 1 ? "s" : ""} with an infrastructure error, left out of the means</span>` : ""}
  </div>`
}

function ablationCard(a: Ablation): string {
  const row = (label: string, value: string, cls: string) => `<dt>${esc(label)}</dt><dd class="${cls}">${esc(value)}</dd>`
  return `<div class="delta">
    <span class="eyebrow">ablation · ${esc(a.variant)} vs ${esc(a.baseline)}</span>
    <dl class="kv">
      ${row("Criteria", points(a.criteria), trend(a.criteria))}
      ${row("Score", signed(a.score, 2), trend(a.score))}
      ${row("Cost", signedUsd(a.costUsd), trend(a.costUsd, true))}
      ${row("Pass rate", a.passRate === undefined ? NONE : `${signed(a.passRate * 100, 0)} pts`, trend(a.passRate))}
    </dl>
  </div>`
}

function heatmap(tests: readonly CtrfTest[]): string {
  const criteria = new Map<string, { text?: string; principal?: boolean; decoy?: boolean }>()
  for (const t of tests) for (const c of extraOf(t).criteria ?? []) if (!criteria.has(c.id)) criteria.set(c.id, c)
  if (criteria.size === 0) return ""
  const head = tests.map((t) => `<th class="c" title="${esc(t.name)}">${esc(variantOf(t))}<br>#${esc(t.labels?.trial ?? "")}</th>`).join("")
  const rows = [...criteria].map(([id, c]) => {
    const tags = `${c.principal ? '<span class="tag principal">principal</span>' : ""}${c.decoy ? '<span class="tag">decoy</span>' : ""}`
    const cells = tests
      .map((t) => {
        const verdict = extraOf(t).criteria?.find((v) => v.id === id)
        if (!verdict) return `<td class="c"><span class="cell na" title="not graded">${NONE}</span></td>`
        const title = `${verdict.met ? "met" : "missed"}${verdict.why ? `: ${verdict.why}` : ""}`
        return `<td class="c"><span class="cell ${verdict.met ? "met" : "miss"}" title="${esc(title)}">${verdict.met ? "✓" : "✗"}</span></td>`
      })
      .join("")
    return `<tr><td class="crit"><span class="crit-id">${esc(id)}</span>${tags}${c.text ? `<div class="msg">${esc(c.text)}</div>` : ""}</td>${cells}</tr>`
  })
  const totals = tests
    .map((t) => {
      const cs = extraOf(t).criteria ?? []
      return `<td class="c mono num">${esc(cs.length > 0 ? cs.filter((c) => c.met).length : NONE)}</td>`
    })
    .join("")
  return `<div class="panel scroll"><table class="heat"><thead><tr><th>Criterion</th>${head}</tr></thead>
    <tbody>${rows.join("")}<tr><td class="muted">Total</td>${totals}</tr></tbody></table></div>`
}

function trialsTable(tests: readonly CtrfTest[]): string {
  const rows = tests.map((t) => {
    const e = extraOf(t)
    const cs = e.criteria ?? []
    return `<tr>
      <td class="mono">${esc(t.name)}</td>
      <td><span class="pill ${esc(t.status)}">${esc(t.status)}</span></td>
      <td class="r mono num">${cs.length > 0 ? `${cs.filter((c) => c.met).length}/${cs.length}` : NONE}</td>
      <td class="r mono num">${e.score === undefined ? NONE : esc(e.score.toFixed(2))}</td>
      <td class="r mono num">${esc(usd(e.costUsd))}</td>
      <td class="r mono num">${e.judgeCalls ? esc(`${e.judgeCalls} · ${usd(e.judgeCostUsd)}`) : NONE}</td>
      <td class="r mono num">${esc(duration(t.duration))}</td>
      <td class="r mono num">${esc(e.turns ?? NONE)}</td>
      <td class="msg">${esc(t.message ?? "")}</td>
    </tr>`
  })
  return `<div class="panel scroll"><table><thead><tr><th>Trial</th><th>Status</th><th class="r">Criteria</th><th class="r">Score</th><th class="r">Cost</th><th class="r">Judge</th><th class="r">Duration</th><th class="r">Turns</th><th>Message</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`
}

/**
 * Renders a CTRF document as one self-contained HTML page: summary, variant comparison with the ablation,
 * criteria × trials heatmap, trials, raw CTRF. No request but the optional Google Fonts stylesheet; light and dark.
 *
 * @example
 * const html = renderHtml(JSON.parse(await readFile("run.ctrf.json", "utf8")))
 */
export function renderHtml(report: CtrfReport, options: RenderOptions = {}): string {
  const { aggregates, ablation } = aggregatesOf(report, options.baseline)
  const tests = report.results.tests
  const cases = [...new Set(tests.map(caseOf))]
  const byCase = cases.map((caseId) => {
    const groups = aggregates.groups.filter((g) => g.caseId === caseId)
    const deltas = ablation.filter((a) => a.caseId === caseId)
    const caseTests = tests.filter((t) => caseOf(t) === caseId)
    return `<section>
      <h2>${esc(caseId)}</h2>
      <div class="variants">${groups.map(variantCard).join("")}${deltas.map(ablationCard).join("")}</div>
      ${heatmap(caseTests)}
    </section>`
  })
  const suiteErrors = (report.results.extra?.suiteErrors ?? []) as string[]
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>proctor · ${esc(report.results.environment?.reportName ?? "run")}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${STYLE}</style>
<body>
<div class="wrap">
${header(report)}
<div class="tabs" role="tablist">
  <button class="tab" role="tab" id="tab-report" aria-selected="true" aria-controls="view-report">Report</button>
  <button class="tab" role="tab" id="tab-json" aria-selected="false" aria-controls="view-json">CTRF JSON</button>
</div>
<div id="view-report" role="tabpanel" aria-labelledby="tab-report" class="wrap">
${summary(report, aggregates.judge.costUsd, aggregates.judge.calls)}
<div class="legend">
  <span><span class="cell met">✓</span>met</span><span><span class="cell miss">✗</span>missed</span>
  <span><span class="cell na">${NONE}</span>not graded (infrastructure error)</span><span>Decoy met = false positive avoided · ablation: variant mean − ${esc(aggregates.baseline)} mean</span>
</div>
${byCase.join("\n")}
<section><h2>Trials</h2>${trialsTable(tests)}</section>
${suiteErrors.map((e) => `<p class="msg"><b>Suite error:</b> ${esc(e)}</p>`).join("")}
</div>
<div id="view-json" role="tabpanel" aria-labelledby="tab-json" hidden>
  <div class="panel">
    <div class="jsonbar"><span class="mono muted">${esc(report.runId ?? "")}.ctrf.json</span><button class="btn" id="copy">Copy JSON</button></div>
    <pre id="json">${esc(JSON.stringify(report, null, 2))}</pre>
  </div>
</div>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

const STYLE = `
:root {
  --bg: #F3F5F4; --surface: #FFFFFF; --ink: #16201C; --muted: #5A6762; --line: #DAE0DD; --soft: #EBEFED;
  --accent: #2F5D8A; --pass: #2B7651; --fail: #B23B2B; --other: #9C6710; --skip: #7A8580;
  --pass-bg: #DDEFE4; --fail-bg: #F6E0DC; --other-bg: #F4E8D2;
  --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --cond: "IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0F1513; --surface: #172019; --ink: #E2E9E6; --muted: #93A19B; --line: #2A3531; --soft: #1D2724;
    --accent: #86ADD8; --pass: #62C08F; --fail: #EE7B67; --other: #DFA84A; --skip: #86928D;
    --pass-bg: #173427; --fail-bg: #3B1E19; --other-bg: #3A2C14;
  }
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 14px/1.5 var(--sans); margin: 0; padding: 28px 16px 56px; }
.wrap { max-width: 1080px; margin: 0 auto; display: grid; gap: 28px; } .wrap .wrap { max-width: none; margin: 0; }
h1, h2 { font-family: var(--cond); font-weight: 600; margin: 0; }
h1 { font-size: 28px; line-height: 1.15; } h2 { font-size: 17px; }
.eyebrow { font: 500 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.mono, code { font-family: var(--mono); font-size: 12.5px; } .num { font-variant-numeric: tabular-nums; } .muted { color: var(--muted); }
header { display: grid; gap: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: 12px/1 var(--mono); padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
.chip b { font-weight: 500; color: var(--muted); margin-right: 4px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.tab { font: 500 13px var(--sans); background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; color: var(--muted); cursor: pointer; margin-bottom: -1px; }
.tab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); }
.tab:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
section { display: grid; gap: 12px; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
.summary { display: grid; gap: 14px; padding: 16px; }
.counts { display: flex; flex-wrap: wrap; gap: 20px 32px; align-items: baseline; }
.count { display: grid; gap: 2px; } .count .v { font: 600 26px/1 var(--cond); }
.count .k { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.bar { display: flex; height: 10px; border-radius: 3px; overflow: hidden; background: var(--soft); } .bar span { display: block; height: 100%; }
.dot.passed, .bar .passed { background: var(--pass); } .dot.failed, .bar .failed { background: var(--fail); }
.dot.other, .bar .other { background: var(--other); } .dot.skipped, .bar .skipped { background: var(--skip); }
.variants { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.variant { padding: 16px; display: grid; gap: 12px; align-content: start; } .variant h3 { margin: 0; font: 600 15px var(--mono); }
.kv { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; margin: 0; } .kv dt { color: var(--muted); }
.kv dd { margin: 0; text-align: right; font: 13px var(--mono); font-variant-numeric: tabular-nums; }
.delta { padding: 16px; display: grid; gap: 12px; align-content: start; background: var(--soft); border: 1px dashed var(--line); border-radius: 6px; }
.up { color: var(--pass); } .down { color: var(--fail); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font: 500 11px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
td.r, th.r { text-align: right; } th.c, td.c { text-align: center; } tr:last-child td { border-bottom: 0; }
.pill { display: inline-flex; font: 500 11.5px/1 var(--mono); padding: 4px 7px; border-radius: 3px; white-space: nowrap; }
.pill.passed { color: var(--pass); background: var(--pass-bg); } .pill.failed { color: var(--fail); background: var(--fail-bg); }
.pill.other { color: var(--other); background: var(--other-bg); } .pill.skipped { color: var(--skip); background: var(--soft); }
.msg { color: var(--muted); font-size: 12.5px; max-width: 46ch; }
.heat td.c { padding: 6px 4px; }
.cell { display: inline-block; width: 26px; height: 22px; border-radius: 3px; font: 500 11px/22px var(--mono); text-align: center; }
.cell.met { background: var(--pass-bg); color: var(--pass); } .cell.miss { background: var(--fail-bg); color: var(--fail); }
.cell.na { background: var(--soft); color: var(--skip); }
.tag { font: 500 10.5px/1 var(--mono); padding: 3px 5px; border-radius: 3px; border: 1px solid var(--line); color: var(--muted); margin-left: 6px; }
.tag.principal { border-color: var(--accent); color: var(--accent); }
.crit { max-width: 46ch; } .crit-id { font: 12px var(--mono); }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--muted); align-items: center; }
.legend .cell { width: 18px; height: 16px; line-height: 16px; vertical-align: middle; margin-right: 4px; }
pre { margin: 0; padding: 16px; overflow: auto; max-height: 70vh; font: 12px/1.55 var(--mono); }
.jsonbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); gap: 12px; flex-wrap: wrap; }
.btn { font: 500 12.5px var(--sans); padding: 6px 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 4px; cursor: pointer; }
`

const SCRIPT = `
const $ = (id) => document.getElementById(id);
function show(json) {
  $("view-report").hidden = json; $("view-json").hidden = !json;
  $("tab-report").setAttribute("aria-selected", String(!json)); $("tab-json").setAttribute("aria-selected", String(json));
}
$("tab-report").onclick = () => show(false);
$("tab-json").onclick = () => show(true);
if (location.hash === "#json") show(true);
$("copy").onclick = async (e) => {
  try { await navigator.clipboard.writeText($("json").textContent); e.target.textContent = "Copied"; }
  catch { getSelection().selectAllChildren($("json")); e.target.textContent = "Selected, copy with ⌘C"; }
  setTimeout(() => (e.target.textContent = "Copy JSON"), 2000);
};
`

/**
 * The HTML report of a CTRF file: same directory, same run id.
 *
 * @example
 * htmlPath("results/review/<runId>.ctrf.json") // "results/review/<runId>.report.html"
 */
export const htmlPath = (ctrfFile: string): string => siblingPath(ctrfFile, ".report.html")

/**
 * Writes the HTML report of a CTRF document and returns its path.
 *
 * @example
 * await writeHtmlReport(report, "results/review/<runId>.report.html")
 */
export function writeHtmlReport(report: CtrfReport, path: string, options: RenderOptions = {}): Promise<string> {
  return writeTextFile(path, renderHtml(report, options))
}

/**
 * CTRF sink writing `<runId>.report.html` next to the `.ctrf.json`.
 *
 * @example
 * new CtrfReporter({ outDir: "results", toolVersion, sinks: [markdownSummary, htmlReport] })
 */
export const htmlReport: CtrfSink = (report, ctrfFile) => writeHtmlReport(report, htmlPath(ctrfFile))
