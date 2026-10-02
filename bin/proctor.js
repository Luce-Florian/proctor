#!/usr/bin/env node
// Registers tsx so the CLI and the *.eval.ts files it loads run from TypeScript sources, without a build step.
import { register } from "tsx/esm/api"

register()
const { main } = await import("../src/cli/main.ts")
const { interruptOnSignals } = await import("../src/cli/interrupt.ts")
// Ctrl-C once: the run stops and cleans up, the partial report is written. Twice: agents are killed, exit 130.
const interrupt = new AbortController()
const release = interruptOnSignals(interrupt)
process.exitCode = await main(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, signal: interrupt.signal })
release()
