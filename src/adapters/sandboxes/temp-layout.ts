import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { delimiter, join, sep } from "node:path"

/** Host variables passed through as is: locale and terminal only. Credentials are added by the agent adapter. */
const PASSTHROUGH = /^(LANG|LC_[A-Z]+|TERM|TZ|USER|LOGNAME)$/

/** Characters of the trial label kept in the temp root name. */
const MAX_SLUG = 12

/** The temp directories of one trial: `root/{work,home,tmp}`. */
export interface TempLayout {
  /** Directory holding everything below, removed by {@link releaseLayout}. */
  readonly root: string
  readonly cwd: string
  readonly home: string
  readonly tmp: string
}

export interface LayoutOptions {
  /** Host environment to filter. Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Host home, whose `PATH` entries are dropped. Default: `os.homedir()`. */
  readonly hostHome?: string
  /** Parent of the temp directories. Default: `os.tmpdir()`. */
  readonly tmpRoot?: string
}

/**
 * Allocates `root/{work,home,tmp}` for one trial.
 *
 * @example
 * const { root, cwd, home, tmp } = await allocateLayout("review [baseline] #1")
 */
export async function allocateLayout(label: string, options: LayoutOptions = {}): Promise<TempLayout> {
  // Kept short: srt puts its proxy sockets under TMPDIR, and macOS truncates socket paths past 104 bytes,
  // so two long trial roots would collide on the same socket (EADDRINUSE).
  const slug = label.replace(/[^A-Za-z0-9]+/g, "-").slice(0, MAX_SLUG)
  const root = await mkdtemp(join(options.tmpRoot ?? tmpdir(), `ae-${slug}-`))
  const layout = { root, cwd: join(root, "work"), home: join(root, "home"), tmp: join(root, "tmp") }
  await Promise.all([layout.cwd, layout.home, layout.tmp].map((dir) => mkdir(dir)))
  return layout
}

/**
 * Removes a trial's temp root, given the root itself or its `work` directory.
 *
 * @example
 * await releaseLayout(dirname(workspace.cwd))
 */
export async function releaseLayout(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

/**
 * The agent environment for a layout: `PATH` without entries under the host home (plugin binaries,
 * user tools), locale, and HOME, TMPDIR, XDG_* pointing inside the layout.
 *
 * @example
 * layoutEnv(layout) // { PATH: "/opt/homebrew/bin:/usr/bin:/bin", HOME: "/tmp/proctor-x/home", ... }
 */
export function layoutEnv(layout: TempLayout, options: LayoutOptions = {}): Record<string, string> {
  const env = options.env ?? process.env
  const hostHome = options.hostHome ?? homedir()
  const underHome = (dir: string) => dir === hostHome || dir.startsWith(`${hostHome}${sep}`) || dir.startsWith("~")
  const path = (env.PATH ?? "").split(delimiter).filter((dir) => dir && !underHome(dir))
  const passthrough = Object.entries(env).filter((e): e is [string, string] => PASSTHROUGH.test(e[0]) && e[1] !== undefined)
  return {
    ...Object.fromEntries(passthrough),
    PATH: path.join(delimiter),
    HOME: layout.home,
    TMPDIR: layout.tmp,
    XDG_CONFIG_HOME: join(layout.home, ".config"),
    XDG_DATA_HOME: join(layout.home, ".local", "share"),
    XDG_STATE_HOME: join(layout.home, ".local", "state"),
    XDG_CACHE_HOME: join(layout.home, ".cache"),
  }
}
