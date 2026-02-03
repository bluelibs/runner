# Durable Dashboard

The operational control center for BlueLibs Runner Durable Workflows. Monitor executions, visualize workflow timelines, and perform manual interventions on stuck or failed workflows.

## Features

- **Mission Control**: Real-time overview of execution health with stats and charts
- **Execution Timeline**: Visual step-by-step view of workflow progress
- **Crash Control**: Manual intervention panel for stuck workflows
  - Retry failed rollbacks
  - Skip problematic steps
  - Force fail workflows
  - Manually patch step state

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **Styling**: TailwindCSS
- **Routing**: react-router-dom v6
- **Charts**: Recharts
- **Icons**: Lucide React
- **Forms**: react-hook-form

## Development

```bash
cd src/node/durable/dashboard

# Install dependencies
npm install

# Start dev server (proxies API to localhost:3000)
npm run dev

# Build UI assets (outputs to the package root at dist/ui)
npm run build
```

## Integration

The dashboard is designed to be served by `createDashboardMiddleware()`:

```typescript
import express from "express";
import {
  createDashboardMiddleware,
  DurableOperator,
  initDurableService,
} from "@bluelibs/runner/node";

const app = express();
const service = await initDurableService({ store, eventBus });
const operator = new DurableOperator(store);

// Mount at /durable-dashboard (or any other prefix)
app.use(
  "/durable-dashboard",
  createDashboardMiddleware(service, operator, {
    operatorAuth: (req) => req.headers["x-ops-token"] === process.env.OPS_TOKEN,
  }),
);

app.listen(3000);
```

## API Endpoints

The dashboard communicates with these backend endpoints:

| Endpoint                      | Method | Description                                   |
| ----------------------------- | ------ | --------------------------------------------- |
| `/api/executions`             | GET    | List executions (supports filters/pagination) |
| `/api/executions/:id`         | GET    | Get execution details                         |
| `/api/operator/retryRollback` | POST   | Retry a failed rollback                       |
| `/api/operator/skipStep`      | POST   | Skip a stuck step                             |
| `/api/operator/forceFail`     | POST   | Force workflow to fail                        |
| `/api/operator/editState`     | POST   | Manually patch step state                     |

> [!NOTE]
> Operator actions are denied unless you provide `operatorAuth`. To opt out, set `dangerouslyAllowUnauthenticatedOperator: true` (not recommended).

## Project Structure

```
src/node/durable/dashboard/
├── index.html          # Vite entry point
├── package.json        # Dependencies
├── vite.config.ts      # Vite config with API proxy
├── tailwind.config.js  # TailwindCSS config
├── server.ts           # Express middleware (backend)
└── src/
    ├── main.tsx        # React entry
    ├── App.tsx         # Router setup
    ├── api.ts          # API client
    ├── index.css       # TailwindCSS imports
    ├── pages/
    │   ├── Dashboard.tsx       # Main overview
    │   ├── ExecutionDetail.tsx # Timeline + controls
    │   └── Schedules.tsx       # (placeholder)
    └── components/
        ├── layout/
        │   ├── Layout.tsx      # App shell
        │   └── Sidebar.tsx     # Navigation
        └── execution/
            ├── Timeline.tsx    # Step visualization
            └── CrashControl.tsx # Operator actions
```

## Execution Statuses

| Status                | Color  | Description                           |
| --------------------- | ------ | ------------------------------------- |
| `pending`             | Yellow | Queued for processing                 |
| `running`             | Blue   | Currently executing                   |
| `sleeping`            | Purple | Waiting for timer/signal              |
| `retrying`            | Orange | Retry scheduled                       |
| `completed`           | Green  | Successfully finished                 |
| `failed`              | Red    | Permanently failed                    |
| `compensation_failed` | Pink   | Rollback crashed - needs intervention |

## Building for Production

```bash
npm run build
```

This creates static assets in `dist/ui/` (at the package root) that are served by the Express middleware.
