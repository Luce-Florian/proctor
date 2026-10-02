// Authoring API: what a `*.eval.ts` file imports.
export { suite, SuiteBuilder } from "./dsl/suite.ts"
export { VariantBuilder, type PromptState } from "./dsl/variant.ts"
export { CaseBuilder, type ExpectationState } from "./dsl/case.ts"
export { directory } from "./fixtures/directory.ts"
export { gitRepo, GitRepoFixture } from "./fixtures/git-repo.ts"
export { regex } from "./graders/regex.ts"
export { judge, Judge, JudgeBuilder } from "./graders/llm-judge.ts"
export { MAX_PROMPT_BYTES } from "./graders/judge-protocol.ts"
export { limits, Limits, LimitsBuilder } from "./graders/limits.ts"
export { readVerdict, verdictEquals, verdictIs, type Verdict, type VerdictOptions, type VerdictWords } from "./graders/verdict-equals.ts"
export { answerShape, type AnswerContract } from "./graders/answer-shape.ts"
export { MAX_REASON_LENGTH, yesNoContract, type YesNoAnswer, type YesNoContractOptions } from "./graders/yes-no-contract.ts"
export { toolUsed, type CallCount } from "./graders/tool-used.ts"
export { jsonPath, type JsonExpectation, type JsonPathOptions } from "./graders/json-path.ts"
export { fileChanged, fileUnchanged, type PathMatch } from "./graders/file-changed.ts"
export {
  escapeRegExp,
  noToolNamed,
  toolCallsFail,
  toolCallsSucceed,
  toolOutputsExclude,
  type FailureEvidence,
  type ToolCallMatch,
} from "./graders/tool-calls.ts"
export { transcriptExcludes } from "./graders/transcript.ts"
export type { Duration } from "./core/duration.ts"

// Running API: what the CLI, and any other host, calls.
export { runSuite, type RunOptions } from "./core/orchestrator.ts"
export { exitCodeFor, ExitCode } from "./core/exit-code.ts"
export { SuiteDefinitionError } from "./core/model.ts"
export { InterruptedError } from "./core/errors.ts"
export { countByStatus, trialLabel } from "./core/trial-summary.ts"
export { ConsoleReporter } from "./reporters/console.ts"
export { CtrfReporter, ctrfPath, toCtrf, type CtrfSink } from "./reporters/ctrf.ts"
export { markdownSummary, renderMarkdown, summaryPath, writeMarkdownSummary } from "./reporters/markdown.ts"
export type { RenderOptions } from "./reporters/format.ts"
export { htmlPath, htmlReport, renderHtml, writeHtmlReport } from "./reporters/html.ts"
export {
  aggregate,
  aggregatesOf,
  DEFAULT_BASELINE,
  type Ablation,
  type Aggregates,
  type GroupAggregate,
  type RunAggregates,
  type Stat,
} from "./reporters/aggregates.ts"
export type * from "./reporters/ctrf-types.ts"
export type * from "./core/model.ts"
export * from "./ports/index.ts"
