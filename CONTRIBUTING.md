# Contributing to proctor

Thanks for your interest in proctor. This guide explains how to report a problem, propose a change and get it merged.

## Maintainer

proctor is maintained by [@Luce-Florian](https://github.com/Luce-Florian), the only person with write access to this repository. Everyone else contributes through issues and pull requests from a fork. The maintainer reviews every pull request, and only the maintainer merges.

## Before you open a pull request

- **Bug**: open an issue with the bug report template. Include a minimal `*.eval.ts`, the command you ran and its output.
- **Feature or behavior change**: open an issue first and describe the use case. A short discussion before you write code saves a rejected pull request.
- **Small fixes** (typos, docs, an obvious bug with a test): a pull request without an issue is fine.
- **Security issue**: do not open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js >= 22.12 and npm.

```sh
git clone https://github.com/<you>/proctor.git
cd proctor
npm ci
npm run check   # format:check + lint + typecheck + all tests
```

| Script                      | What it runs                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| `npm run test:unit`         | specs `src/**/*.spec.ts`, next to their module                                    |
| `npm run test:behavior`     | `test/**/*.test.ts`: the package as a user drives it (DSL, `runSuite`, CLI, docs) |
| `npm run test:architecture` | `test/architecture.test.ts`: the import boundaries between layers                 |
| `npm run lint`              | ESLint, including the import boundaries rule (`eslint/import-boundaries.js`)      |
| `npm run typecheck`         | `tsc --noEmit`                                                                    |
| `npm run format`            | Prettier                                                                          |
| `npm run build`             | type declarations in `dist/` (run by `prepack`)                                   |

Tests never use the network or real credentials: `test/support/setup.ts` clears credential variables and fails any test that opens a connection. Tests never read files outside the repository.

[CLAUDE.md](CLAUDE.md) describes the architecture, the layers and the coding conventions. Read it before a non-trivial change. It is written for coding agents, and it applies to humans too.

## Pull requests

- Branch from `main`. Keep each pull request focused on one change.
- Add or update tests for every behavior change. A bug fix comes with a test that fails without the fix.
- Update `README.md` when you change the public API or the CLI. Its `ts` examples are compiled by the tests.
- `npm run check` must pass locally. CI runs the same checks on Node 22.12, 22 and 24.
- Don't edit `CHANGELOG.md` or the version in `package.json`: release-please maintains both.

### Commit messages and pull request titles

Use [Conventional Commits](https://www.conventionalcommits.org/). release-please reads them to choose the next version and write the changelog. Pull requests are squash-merged, so the pull request title becomes the commit message.

```
feat(graders): add a jsonSchema grader
fix(cli): exit with code 2 when the suite file is missing
docs: explain fixtures in the README
```

| Type                                               | Use for                   | Release |
| -------------------------------------------------- | ------------------------- | ------- |
| `feat`                                             | a new feature             | minor   |
| `fix`                                              | a bug fix                 | patch   |
| `perf`                                             | a performance improvement | patch   |
| `refactor`, `test`, `docs`, `build`, `ci`, `chore` | no change in behavior     | none    |

A breaking change adds `!` after the type (`feat!: ...`) or a `BREAKING CHANGE:` footer. Before 1.0, a breaking change bumps the minor version.

## Releases

Releases are automated. Every merge to `main` updates a release pull request opened by release-please. When the maintainer merges it, the version is tagged, a GitHub release is created and the package is published to npm as [`@fluce/proctor`](https://www.npmjs.com/package/@fluce/proctor), with provenance.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
