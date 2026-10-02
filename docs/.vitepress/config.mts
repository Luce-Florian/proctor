import { defineConfig, type DefaultTheme } from "vitepress"
import { withMermaid } from "vitepress-plugin-mermaid"

const repo = "https://github.com/Luce-Florian/proctor"

type Locale = "en" | "fr"

/** A page of the sidebar: its path under the locale root, and its title in each locale. */
interface Page {
  readonly path: string
  readonly title: Record<Locale, string>
}

interface Section {
  readonly title: Record<Locale, string>
  readonly pages: readonly Page[]
}

/**
 * The tree of the docs, shared by every locale: `docs/<path>.md` in English, `docs/fr/<path>.md` in French.
 * `test/docs.test.ts` checks that both trees hold the same pages.
 */
const sections: readonly Section[] = [
  {
    title: { en: "Introduction", fr: "Introduction" },
    pages: [{ path: "getting-started", title: { en: "Getting started", fr: "Getting started" } }],
  },
  {
    title: { en: "Writing evals", fr: "Writing evals" },
    pages: [
      { path: "writing-evals/", title: { en: "Suites, variants, cases", fr: "Suites, variants, cases" } },
      { path: "writing-evals/fixtures", title: { en: "Fixtures", fr: "Fixtures" } },
      { path: "writing-evals/graders", title: { en: "Graders", fr: "Graders" } },
      { path: "writing-evals/yes-no-answers", title: { en: "Yes/no answers", fr: "Yes/no answers" } },
      { path: "writing-evals/judge", title: { en: "LLM judge", fr: "LLM judge" } },
      { path: "writing-evals/lifecycle", title: { en: "Lifecycle", fr: "Lifecycle" } },
    ],
  },
  {
    title: { en: "Running", fr: "Running" },
    pages: [
      { path: "running/cli", title: { en: "CLI", fr: "CLI" } },
      { path: "running/reports", title: { en: "Reports and ablation", fr: "Reports and ablation" } },
      { path: "running/ctrf", title: { en: "CTRF reference", fr: "CTRF reference" } },
    ],
  },
  {
    title: { en: "Agents and sandboxes", fr: "Agents and sandboxes" },
    pages: [
      { path: "agents/claude-code/", title: { en: "Claude Code", fr: "Claude Code" } },
      { path: "agents/claude-code/auth", title: { en: "Claude Code: auth", fr: "Claude Code: auth" } },
      { path: "agents/claude-code/plugins", title: { en: "Claude Code: plugins", fr: "Claude Code: plugins" } },
      { path: "agents/claude-code/isolation-probe", title: { en: "Claude Code: isolation probe", fr: "Claude Code: isolation probe" } },
      { path: "sandboxes", title: { en: "Sandboxes", fr: "Sandboxes" } },
    ],
  },
  {
    title: { en: "Legacy bash bench", fr: "Legacy bash bench" },
    pages: [
      { path: "legacy/loader", title: { en: "Legacy loader", fr: "Legacy loader" } },
      { path: "legacy/porting", title: { en: "Porting a theme", fr: "Porting a theme" } },
    ],
  },
  {
    title: { en: "Contributing", fr: "Contributing" },
    pages: [
      { path: "contributing/architecture", title: { en: "Architecture", fr: "Architecture" } },
      { path: "contributing/extending", title: { en: "Extending", fr: "Extending" } },
    ],
  },
  {
    title: { en: "Validation campaigns", fr: "Validation campaigns" },
    pages: [
      { path: "campaigns/", title: { en: "Overview", fr: "Overview" } },
      {
        path: "campaigns/2026-09-30-isolation-parity",
        title: { en: "2026-09-30: isolation and parity", fr: "2026-09-30: isolation and parity" },
      },
      { path: "campaigns/2026-09-30-judge", title: { en: "2026-09-30: judge", fr: "2026-09-30: judge" } },
      { path: "campaigns/2026-10-02-ported-theme", title: { en: "2026-10-02: ported theme", fr: "2026-10-02: ported theme" } },
    ],
  },
  {
    title: { en: "Reference", fr: "Reference" },
    pages: [{ path: "limitations", title: { en: "Known limitations", fr: "Known limitations" } }],
  },
]

const sidebar = (locale: Locale): DefaultTheme.SidebarItem[] => {
  const root = locale === "en" ? "/" : `/${locale}/`
  return sections.map((section) => ({
    text: section.title[locale],
    items: section.pages.map((page) => ({ text: page.title[locale], link: `${root}${page.path}` })),
  }))
}

export default withMermaid(
  defineConfig({
    title: "proctor",
    description: "Evaluation harness for coding agents: xUnit lifecycle, one sandbox per trial, CTRF reports.",
    base: "/proctor/",
    cleanUrls: true,
    lastUpdated: true,
    locales: {
      root: {
        label: "English",
        lang: "en",
        themeConfig: {
          nav: [
            { text: "Guide", link: "/getting-started" },
            { text: "CLI", link: "/running/cli" },
            { text: "Changelog", link: `${repo}/blob/main/CHANGELOG.md` },
          ],
          sidebar: sidebar("en"),
        },
      },
      fr: {
        label: "Français",
        lang: "fr",
        themeConfig: {
          nav: [
            { text: "Guide", link: "/fr/getting-started" },
            { text: "CLI", link: "/fr/running/cli" },
            { text: "Changelog", link: `${repo}/blob/main/CHANGELOG.md` },
          ],
          sidebar: sidebar("fr"),
        },
      },
    },
    themeConfig: {
      search: { provider: "local" },
      socialLinks: [
        { icon: "github", link: repo },
        { icon: "npm", link: "https://www.npmjs.com/package/@fluce/proctor" },
      ],
      editLink: { pattern: `${repo}/edit/main/docs/:path` },
      outline: [2, 3],
    },
  }),
)
