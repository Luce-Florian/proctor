# Security policy

proctor runs coding agents inside sandboxes and handles their credentials, so isolation and credential leaks are in scope. Examples: a sandbox escape, a credential that reaches a transcript or a report unredacted, or a path that a trial can read or write outside its workspace.

## Supported versions

Only the latest published version of `@fluce/proctor` receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Report it privately through [GitHub private vulnerability reporting](https://github.com/Luce-Florian/proctor/security/advisories/new). Include the version, the platform (macOS or Linux, and the sandbox used), the steps to reproduce and the impact.

You will get an acknowledgement within 7 days. Once the issue is confirmed, a fix is released as soon as possible, and the advisory is published with credit to you unless you prefer to stay anonymous.
