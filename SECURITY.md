# Security Policy

BlueLibs Runner takes security reports seriously. If you discover a vulnerability, please report it privately so we can investigate and patch before public disclosure.

## Supported Versions

We provide security fixes for the latest major version.

| Version | Supported |
| --- | --- |
| 6.x (latest) | Yes |
| 5.x | Best effort |
| < 5.x | No |

## Reporting a Vulnerability

Please use GitHub's private vulnerability reporting flow:

- Open: `https://github.com/bluelibs/runner/security/advisories/new`
- Include reproduction details, affected versions, impact, and any suggested fix.
- Do not open a public issue for security vulnerabilities.

If you cannot use GitHub advisories, open a regular issue and provide only non-sensitive contact instructions. We will move the conversation to a private channel.

## What to Expect

- Acknowledgement target: within 3 business days.
- Initial triage target: within 7 business days.
- We will keep you informed on status, severity, and remediation plan.
- After a fix is released, we will coordinate responsible disclosure and credit when desired.

## Scope

This policy applies to:

- `@bluelibs/runner` package source
- Official examples and first-party integrations in this repository

Out of scope:

- Vulnerabilities requiring compromised developer workstations or package registries
- Reports without a reproducible scenario

## Disclosure Guidance

- Do not publish proof-of-concept exploit details before a fix is available.
- We may assign CVEs when impact warrants it.
- Security fixes may be backported at maintainer discretion.
