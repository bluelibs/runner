# Studio Screenshot Captures

Captures land in this folder (`docs/shots/`) via one command from the example
root — it builds the client, drives the demo views in Chrome, and screenshots
each state, including real tab, modal, schedule-edit, and signal interactions:

```bash
npm run shots
```

Requires Google Chrome (or set `SHOTS_CHROME` to a Chromium binary).
The generated PNGs are local review artifacts and are intentionally ignored by
Git.

## The set

| File | View | What it shows |
| --- | --- | --- |
| `00-login.png` | `?demo=1&auth=1` | Locked studio login screen with the demo token hint |
| `01-incident-live.png` | `?demo=1&select=demo_inc_live` | Incident parked on its approval wait: countdown, taken `acked` branch, one-click signal |
| `02-order-completed.png` | `?demo=1&select=demo_ord_completed` | Completed order: every node green with results |
| `03-chaos-failed.png` | `?demo=1&select=demo_inc_failed` | Failed chaos run: error banner and precise failed `diagnose` step |
| `04-schedules.png` | `?demo=1&view=schedules` | Schedule management: active/paused timers |
| `05-start-modal.png` | `?demo=1&modal=start` | Start dialog with workflow picker and presets |
| `06-signal-modal.png` | `?demo=1&select=demo_inc_live&modal=signal` | Signal dialog with payload presets |
| `07-audit-tab.png` | incident + Audit click | Persisted audit trail entries |
| `08-onboarding-live.png` | `?demo=1&select=demo_onb_live` | Onboarding mid-run with active nodes |
| `09-incident-resolved.png` | incident + real signal send | The same incident completed via the UI |
| `10-overview.png` | `?demo=1` | Live operations dashboard with search, filters, metrics, insights, charts, latest runs, and workflow health |
| `11-portfolio-tree.png` | portfolio + Tree click | Parent execution fan-out with three navigable regional children |
| `12-child-loop.png` | `?demo=1&select=demo_rollup_apac` | APAC child inside a three-iteration loop with the final batch active |
| `13-signal-history.png` | incident + Signals click | Delivered, consumed, and queued signal records with payload inspection |
| `14-edit-state.png` | portfolio + Operate → Edit state | Guarded state-repair flow with step selection, JSON editor, and required audit reason |
| `15-schedule-edit.png` | schedules + Edit click | In-place schedule cadence and input editing |

Drop `demo=1` from any link for the equivalent view against the live runtime
(`npm start` → http://localhost:4317).
