import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { onTestFinished } from "vitest"
import type { AgentRunResult, Fixture, GradeContext, Grader } from "@fluce/proctor"

/** Absolute path of a file under `test/fixtures/`, from a spec next to its source as from a behavior test. */
export const fixturePath = (...segments: string[]): string => join(fileURLToPath(new URL("../fixtures/", import.meta.url)), ...segments)

/** A temp directory removed when the current test finishes. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "proctor-test-"))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** A grader that records "assert" and returns the given verdict. */
export function recordingGrader(events: string[], passed = true, id = "recorded"): Grader {
  return {
    id,
    grade: async () => {
      events.push("assert")
      return { graderId: id, passed, criteria: [{ id, met: passed }] }
    },
  }
}

/** A fixture that records its setup and teardown, optionally failing on setup or teardown. */
export function recordingFixture(events: string[], label = "", options: { failOnSetup?: boolean; failOnTeardown?: boolean } = {}): Fixture {
  const suffix = label ? `:${label}` : ""
  return {
    description: `recording${suffix}`,
    setup: async () => {
      if (options.failOnSetup) throw new Error(`setup${suffix} exploded`)
      events.push(`setup${suffix}`)
      return async () => {
        events.push(`teardown${suffix}`)
        if (options.failOnTeardown) throw new Error(`teardown${suffix} exploded`)
      }
    },
  }
}

/** What a grader receives for a run that answered `result`, with a fake agent and sandbox. */
export function gradeContext(result: Partial<AgentRunResult>, overrides: Partial<GradeContext> = {}): GradeContext {
  return {
    caseId: "c",
    variant: "v",
    workspace: { cwd: "/", home: "/", env: {} },
    result: { finalText: "", durationMs: 0, turns: 1, toolCalls: [], ...result },
    trial: 1,
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** Runs git in `cwd` with a throw-away identity, no signing; returns trimmed stdout. */
export const gitIn =
  (cwd: string) =>
  (...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      encoding: "utf8",
    }).trim()
