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
    pages: [{ path: "getting-started", title: { en: "Getting started", fr: "Démarrer" } }],
  },
  {
    title: { en: "Writing evals", fr: "Écrire des evals" },
    pages: [
      { path: "writing-evals/", title: { en: "Suites, variants, cases", fr: "Suites, variantes, cas" } },
      { path: "writing-evals/fixtures", title: { en: "Fixtures", fr: "Fixtures" } },
      { path: "writing-evals/graders", title: { en: "Graders", fr: "Évaluateurs" } },
      { path: "writing-evals/yes-no-answers", title: { en: "Yes/no answers", fr: "Réponses oui/non" } },
      { path: "writing-evals/judge", title: { en: "LLM judge", fr: "Juge LLM" } },
      { path: "writing-evals/lifecycle", title: { en: "Lifecycle", fr: "Cycle de vie" } },
    ],
  },
  {
    title: { en: "Running", fr: "Exécution" },
    pages: [
      { path: "running/cli", title: { en: "CLI", fr: "CLI" } },
      { path: "running/reports", title: { en: "Reports and ablation", fr: "Rapports et ablation" } },
      { path: "running/ctrf", title: { en: "CTRF reference", fr: "Référence CTRF" } },
    ],
  },
  {
    title: { en: "Agents and sandboxes", fr: "Agents et sandboxes" },
    pages: [
      { path: "agents/claude-code/", title: { en: "Claude Code", fr: "Claude Code" } },
      { path: "agents/claude-code/auth", title: { en: "Claude Code: auth", fr: "Claude Code : authentification" } },
      { path: "agents/claude-code/plugins", title: { en: "Claude Code: plugins", fr: "Claude Code : plugins" } },
      { path: "agents/claude-code/isolation-probe", title: { en: "Claude Code: isolation probe", fr: "Claude Code : sonde d'isolation" } },
      { path: "sandboxes", title: { en: "Sandboxes", fr: "Sandboxes" } },
    ],
  },
  {
    title: { en: "Legacy bash bench", fr: "Banc bash historique" },
    pages: [
      { path: "legacy/loader", title: { en: "Legacy loader", fr: "Loader historique" } },
      { path: "legacy/porting", title: { en: "Porting a theme", fr: "Porter un thème" } },
    ],
  },
  {
    title: { en: "Contributing", fr: "Contribuer" },
    pages: [
      { path: "contributing/architecture", title: { en: "Architecture", fr: "Architecture" } },
      { path: "contributing/extending", title: { en: "Extending", fr: "Extension" } },
    ],
  },
  {
    title: { en: "Validation campaigns", fr: "Campagnes de validation" },
    pages: [
      { path: "campaigns/", title: { en: "Overview", fr: "Vue d'ensemble" } },
      {
        path: "campaigns/2026-09-30-isolation-parity",
        title: { en: "2026-09-30: isolation and parity", fr: "2026-09-30 : isolation et parité" },
      },
      { path: "campaigns/2026-09-30-judge", title: { en: "2026-09-30: judge", fr: "2026-09-30 : juge" } },
      { path: "campaigns/2026-10-02-ported-theme", title: { en: "2026-10-02: ported theme", fr: "2026-10-02 : thème porté" } },
    ],
  },
  {
    title: { en: "Reference", fr: "Référence" },
    pages: [{ path: "limitations", title: { en: "Known limitations", fr: "Limitations connues" } }],
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
          outline: { label: "Sur cette page", level: [2, 3] },
          docFooter: { prev: "Page précédente", next: "Page suivante" },
          lastUpdated: { text: "Mis à jour le" },
          editLink: { pattern: `${repo}/edit/main/docs/:path`, text: "Modifier cette page sur GitHub" },
          darkModeSwitchLabel: "Apparence",
          lightModeSwitchTitle: "Passer au thème clair",
          darkModeSwitchTitle: "Passer au thème sombre",
          sidebarMenuLabel: "Menu",
          returnToTopLabel: "Retour en haut",
          langMenuLabel: "Changer de langue",
          notFound: {
            title: "PAGE INTROUVABLE",
            quote: "Cette page n'existe pas, ou plus. Le lien est peut-être erroné.",
            linkLabel: "Aller à l'accueil",
            linkText: "Retour à l'accueil",
            code: "404",
          },
        },
      },
    },
    themeConfig: {
      search: {
        provider: "local",
        options: {
          locales: {
            fr: {
              translations: {
                button: { buttonText: "Rechercher", buttonAriaLabel: "Rechercher" },
                modal: {
                  displayDetails: "Afficher la liste détaillée",
                  resetButtonTitle: "Effacer la recherche",
                  backButtonTitle: "Fermer la recherche",
                  noResultsText: "Aucun résultat pour",
                  footer: {
                    selectText: "pour sélectionner",
                    selectKeyAriaLabel: "Entrée",
                    navigateText: "pour naviguer",
                    navigateUpKeyAriaLabel: "Flèche haut",
                    navigateDownKeyAriaLabel: "Flèche bas",
                    closeText: "pour fermer",
                    closeKeyAriaLabel: "Échap",
                  },
                },
              },
            },
          },
        },
      },
      socialLinks: [
        { icon: "github", link: repo },
        { icon: "npm", link: "https://www.npmjs.com/package/@fluce/proctor" },
      ],
      editLink: { pattern: `${repo}/edit/main/docs/:path` },
      outline: [2, 3],
    },
  }),
)
