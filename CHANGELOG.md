# Changelog

## [0.3.0](https://github.com/Luce-Florian/proctor/compare/v0.2.1...v0.3.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* `AgentRunInput.mcpStubs` and `GradeContext.mcpStubs` are required; code that builds one by hand passes `mcpStubs: []`.

### Features

* MCP stubs in evals ([#27](https://github.com/Luce-Florian/proctor/issues/27)) ([9d3ca1f](https://github.com/Luce-Florian/proctor/commit/9d3ca1fc4ff515c78267409b2c66ca638d3c6732))

## [0.2.1](https://github.com/Luce-Florian/proctor/compare/v0.2.0...v0.2.1) (2026-11-04)


### Bug Fixes

* **package:** keep the proctor bin when npm 11 publishes ([#20](https://github.com/Luce-Florian/proctor/issues/20)) ([f8d3d60](https://github.com/Luce-Florian/proctor/commit/f8d3d60e0d2d8e2525c752989ead5a8716c04961))

## [0.2.0](https://github.com/Luce-Florian/proctor/compare/v0.1.0...v0.2.0) (2026-11-04)


### Features

* **cli:** check the sandbox in a dry run with --agent fake ([#18](https://github.com/Luce-Florian/proctor/issues/18)) ([c4a8cb7](https://github.com/Luce-Florian/proctor/commit/c4a8cb7888b341a8216352e60e57d21eb9ccfcd1))


### Bug Fixes

* **srt:** keep the workspace writable under bubblewrap on Linux ([#17](https://github.com/Luce-Florian/proctor/issues/17)) ([048759c](https://github.com/Luce-Florian/proctor/commit/048759c1a3aa4299cfc4cd0b47de2ab6e56adec7))

## 0.1.0 (2026-10-02)


### Features

* initial release of proctor, an evaluation harness for coding agents ([80e81a8](https://github.com/Luce-Florian/proctor/commit/80e81a86819cfc32b0312e187b1278710342a503))
