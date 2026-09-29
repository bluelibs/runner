# Tagged Task Scheduling

## Scope And Maintenance

Cron discovers tasks tagged with the builtin cron tag and invokes them through
Runner's task runner. Scheduling state and timers belong to each resource
instance; this shared-platform scheduler does not own remote durable workflows.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `cron.resource.ts` wires cron tag discovery, logger, store ID resolution, and
  task runner; its context owns the scheduler for cooldown/disposal.
- `CronScheduler.ts` selects tagged tasks, starts immediate/scheduled work,
  exposes schedule snapshots, handles failures, and stops timers.
- `cron-parser.ts` validates expressions/timezones and computes the next run.
- `parseCronResourceConfig.ts` validates resource options and resolves `only`
  task references to the runtime IDs used by discovery.
- `cron.tag.ts` defines the typed task tag and tag configuration schema.
- `types.ts` defines public configuration and observable schedule values.
- `cron.errors.ts` supplies typed parse/execution failures.

## Contracts To Preserve

- Scheduled state and `only` filters use canonical runtime task IDs. Resolve
  definition references through the store before comparing discovery matches.
- Tagged discovery entries include both definition and configured tag value;
  preserve those values rather than rediscovering config by a lossy local ID.
- The parser owns time semantics. Validate expressions and timezones and test
  next-run boundaries rather than relying on the machine's current locale.
- Schedule one timeout for each next run; stop flags prevent a late callback or
  completed execution from restarting a cooled-down/disposed schedule.
- Cooldown stops every schedule; disposal also clears retained state. Keep both
  safe when initialization did not establish a scheduler.
- A shutdown-lockdown rejection stops the schedule without ordinary failure
  logging. Keep error-policy behavior for other task failures.
- `schedules` returns a detached map of observable values, not mutable internal
  task state. `only` entries that are not tagged tasks produce warnings.

## Tests

- `../../__tests__/globals/cron.parser.test.ts`
- `../../__tests__/globals/cron.parse-config.test.ts`
- `../../__tests__/globals/cron.tag.test.ts`
- `../../__tests__/globals/cron.resource.test.ts`
- `../../__tests__/globals/cron.resource.resolve-id.coverage.test.ts`
- `../../__tests__/globals/cron.resource.shutdown.test.ts`

Use fake timers and an explicit system time for scheduling tests. Include
cooldown/dispose and canonical-ID filtering cases, then run QA for source edits.
