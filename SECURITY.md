# Security Policy

ComiCode handles provider API keys, local project files, and shell execution. We
take security reports seriously.

## Supported versions

Security fixes target the latest released minor version. Before 1.0, fixes are
provided on the latest `0.x` release only.

| Version        | Supported |
| -------------- | --------- |
| latest `0.x`   | Yes       |
| older versions | No        |

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Use GitHub's private vulnerability reporting for this repository
(Security → Report a vulnerability), or contact the maintainer privately through
the contact method listed on the repository profile.

Please include:

- A description of the issue and its impact.
- Reproduction steps or a minimal proof of concept.
- Affected version and platform.
- Whether credentials, filesystem access, or command execution are involved.
- Any suggested remediation.

You can expect an acknowledgment within 72 hours and a status update within
7 days. Please allow time for a fix before public disclosure.

## In scope

- Credential storage, masking, redaction, or export leaks.
- Authentication/authorization mistakes in provider or custom-endpoint handling.
- Path traversal, symlink escape, or writes outside the project root.
- Command injection, unsafe shell quoting, or environment leakage.
- Patch/diff application writing unintended files or content.
- Permission-gating bypasses (file writes, deletes, commands, dangerous commands,
  secret reads, paid fallbacks).
- Prompt-injection paths that cause unapproved destructive actions.
- SQLite injection or unsafe deserialization of task/checkpoint data.
- Denial of service caused by unbounded input, recursion, or process spawning.

## Out of scope

- Vulnerabilities in third-party AI providers or their APIs.
- Incorrect model output, hallucinations, or code quality issues.
- Costs incurred by using paid models that the user explicitly enabled.
- Attacks requiring an already-compromised local account or root access.
- Reports that require disabling documented safety controls.

## Safe defaults to verify

ComiCode blocks paid fallbacks, file writes, commands, dangerous commands, and
secret-file access by default. If you find a path that performs any of these
without an explicit user opt-in or approval, treat it as a security issue.

## Handling secrets in reports

Never include real API keys or private source code. Use redacted placeholders
such as `sk-REDACTED` and a minimal synthetic reproduction instead.
