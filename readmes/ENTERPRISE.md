# BlueLibs Runner — Enterprise

Build reliable, observable, and compliant services with a TypeScript-first framework designed for governed environments.

- Strong typing and explicit dependency graphs
- Tasks, Resources, Events, Middleware as clear building blocks
- First-class observability and graceful lifecycle management
- Predictable releases with LTS options
- Enterprise support with SLAs and architecture guidance

---

## Why Enterprises Choose BlueLibs Runner

- Reliability by design
  - Validated dependency graph at boot (dry-run option)
  - Error boundaries and graceful shutdown
  - Resilience patterns: retries, timeouts, caching

- Operability out of the box
  - Structured logging with configurable formats
  - System lifecycle events for orchestration
  - Task- and event-level observability hooks

- Performance at scale
  - Minimal-overhead DI and middleware
  - Async-first, highly concurrent execution
  - Benchmark guidance and tuning tips

- Low-risk adoption
  - Type-safe contracts reduce defects
  - Modular, opt-in architecture
  - Clear upgrade and migration paths

---

## Long-Term Support (LTS) & Release Governance

We align with enterprise change management: stability, predictability, and controlled upgrades.

- Semantic Versioning
  - Patch: bug/security fixes, no breaking changes
  - Minor: backward-compatible improvements
  - Major: planned, documented changes with migration guides

- LTS Policy (current)
  - Version 4.x LTS (current)
    - Released: August 2025
    - Active support until: January 2027
    - Security patches until: January 2029

- Governance and Change Management
  - Deprecation policy with advance notice
  - Documented migration guides for major versions
  - Optional dry-run to validate dependency graphs in CI

---

## Security & Compliance

Operate confidently under security review and audit.

- Security posture
  - No telemetry by default
  - Small, explicit surface area (functional DI, no hidden globals)
  - Error boundary and controlled shutdown hooks

- Vulnerability management
  - Rapid triage and patching for reported issues
  - Coordinated disclosure process (contact below)
  - Clear security advisories and release notes

- Supply chain considerations
  - Deterministic builds via lockfiles
  - Compatible with private registries/proxies
  - Supports Node.js LTS releases

- Data handling
  - Framework does not persist data by itself
  - Configurable structured logging to avoid sensitive output

Security contact: theodor@bluelibs.com

---

## Operability: Observability, Resilience, and Lifecycle

- Observability
  - Structured logger with multiple output strategies
  - System-ready event to coordinate startup
  - Debug modes for local/incident analysis

- Resilience
  - Retry middleware with configurable strategies
  - Timeout middleware (AbortController-based)
  - Caching middleware for expensive operations

- Lifecycle
  - Graceful shutdown (SIGINT/SIGTERM)
  - Uncaught exception/rejection handling
  - Resource disposal in reverse dependency order

---

## Compatibility & Environments

- TypeScript-first (strong types across tasks/resources/events)
- Node.js: modern LTS versions
- Integrations:
  - HTTP servers (e.g., Express)
  - Message/event systems
  - Async-capable data stores and services

---

## Support Plans

- Professional Support
  - 4-hour response for urgent issues (business hours)
  - Guidance on configuration, debugging, and best practices
  - Covers one production application
  - Up to 25 developers

- Enterprise Support
  - 1-hour response for urgent issues, 24/7 for critical incidents
  - Dedicated support engineer familiar with your setup
  - Architecture reviews and performance guidance
  - Covers one production application
  - Up to 100 developers

- Strategic Support (Custom)
  - Custom SLAs and escalation paths
  - Multi-app, multi-team rollouts
  - Training and quarterly reviews
  - Input on roadmap and feature planning

Severity targets (typical):

- Sev-1 (Production down/data loss): 1h response (24/7), work until mitigated
- Sev-2 (Critical degradation, no workaround): 4h response, prioritized mitigation
- Sev-3 (Non-critical defect, workaround exists): next business day response
- Sev-4 (How-to/consulting): 2 business days

---

## Custom Work

Extend the framework for your environment without bespoke debt.

- Framework Extensions
  - Custom middleware (security, compliance, integrations)
  - Observability adapters

- Migration Tooling
  - From legacy frameworks/systems
  - Data/config transformations and compatibility shims

- Integration Adapters
  - Message queues, proprietary protocols, legacy services

- Performance Engineering
  - Profiling and optimization
  - Tailored caching and resource pooling

Delivery model:

- Discovery → Fixed proposal (scope, timeline) → Dev & test → Documentation & handover

---

## Adoption Playbook

A practical, low-risk path from evaluation to production.

1. Evaluation (days)

- Run example apps and benchmarks
- Validate logging, shutdown, retries/timeouts
- Use dry-run in CI to inspect dependency graphs

2. Pilot (weeks)

- Wrap one service/workflow with tasks/resources/middleware
- Add observability and resilience policies
- Define SLOs and validate on staging

3. Production rollout (weeks+)

- Phase-by-phase migration
- Architecture review and performance check
- Runbooks and on-call integration
- Formalize support plan and escalation

Success metrics:

- MTTR and incident count trending down
- Error rate and p95 latency stable or improved
- Predictable, low-friction upgrades

---

## Getting Started

- Schedule a call: theodor@bluelibs.com
- For rapid evaluations, share timelines and constraints to fast-track review.

Please include:

- Team size, criticality, and environment (cloud/on‑prem)
- Target Node.js/TypeScript versions
- Security/compliance requirements
- Desired timelines and success
