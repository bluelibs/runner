import express, { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { IDurableService } from '../core/interfaces/service';
import { DurableOperator } from '../core/DurableOperator';
import type { ExecutionStatus } from '../core/types';

export function createDashboardMiddleware(
  service: IDurableService,
  operator: DurableOperator
): Router {
  const router = Router();
  const api = Router();

  // API: List Executions with filtering
  api.get('/executions', async (req, res) => {
    try {
      const store = (service as any).config.store;
      
      // Parse query params
      const statusParam = req.query.status as string | undefined;
      const status = statusParam ? statusParam.split(',') as ExecutionStatus[] : undefined;
      const taskId = req.query.taskId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      
      // Use new listExecutions if available, fallback to listIncompleteExecutions
      let executions;
      if (store.listExecutions) {
        executions = await store.listExecutions({ status, taskId, limit, offset });
      } else {
        // Fallback for stores that haven't implemented the new method
        executions = await store.listIncompleteExecutions();
      }
      
      res.json(executions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get Execution Detail with steps
  api.get('/executions/:id', async (req, res) => {
    try {
      const store = (service as any).config.store;
      const execution = await store.getExecution(req.params.id);
      if (!execution) {
        return res.status(404).json({ error: 'Execution not found' });
      }
      
      // Fetch step results if store supports it
      let steps = [];
      if (store.listStepResults) {
        steps = await store.listStepResults(req.params.id);
      }
      
      res.json({ ...execution, steps });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Operator Actions
  api.post('/operator/:action', async (req, res) => {
    const { action } = req.params;
    const { executionId, stepId, reason, state } = req.body;

    try {
      switch (action) {
        case 'retryRollback':
          await operator.retryRollback(executionId);
          break;
        case 'skipStep':
          await operator.skipStep(executionId, stepId);
          break;
        case 'forceFail':
          await operator.forceFail(executionId, reason || 'Operator forced fail');
          break;
        case 'editState':
          await operator.editState(executionId, stepId, state);
          break;
        default:
          return res.status(400).json({ error: 'Unknown action' });
      }
      
      // If we performed an action that might unblock the workflow,
      // we should nudge the service to pick it up.
      // retryRollback sets status to pending -> Poller or Queue will pick it up.
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.use('/api', express.json(), api);

  // Serve Static Assets directly from the package's dist/ui folder
  // logic: find where this file is, go up to package root, find dist/ui
  // When running in TS source (dev), we might not have dist/ui.
  // We assume the user builds the dashboard before running this in prod.
  
  const uiDistPath = path.resolve(__dirname, '../../../../dist/ui');
  
  if (fs.existsSync(uiDistPath)) {
      router.use(express.static(uiDistPath));
      router.get('*', (req, res) => {
          res.sendFile(path.join(uiDistPath, 'index.html'));
      });
  } else {
      router.get('/', (req, res) => {
          res.send(`
            <h1>Durable Dashboard</h1>
            <p>UI Artifacts not found at ${uiDistPath}</p>
            <p>Please run <code>npm run build:dashboard</code> in the package.</p>
          `);
      });
  }

  return router;
}
