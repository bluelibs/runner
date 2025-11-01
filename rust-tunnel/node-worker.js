#!/usr/bin/env node

/**
 * Node.js worker process that receives task/event execution requests
 * from the Rust HTTP server via stdin and returns results via stdout.
 *
 * This keeps Node.js focused on business logic while Rust handles
 * all HTTP concerns (routing, CORS, validation, etc.)
 */

const readline = require('readline');

// Mock task/event registry - in real usage, this would import your actual tasks
const taskHandlers = new Map();
const eventHandlers = new Map();

// Register example tasks
taskHandlers.set('app.tasks.add', async (input) => {
  const a = input.a || 0;
  const b = input.b || 0;
  return a + b;
});

taskHandlers.set('app.tasks.greet', async (input) => {
  const name = input.name || 'World';
  return `Hello, ${name}!`;
});

taskHandlers.set('app.tasks.echo', async (input) => {
  return input;
});

// Register example events
eventHandlers.set('app.events.notify', async (payload) => {
  console.error('[Event] notify:', payload); // Use stderr for logs
});

eventHandlers.set('app.events.log', async (payload) => {
  console.error('[Event] log:', payload.message);
});

// Set up stdin/stdout communication
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);

    // Send response back to Rust via stdout
    console.log(JSON.stringify(response));
  } catch (error) {
    console.error('[Worker Error]', error);

    // Send error response
    const errorResponse = {
      id: 0,
      ok: false,
      error: {
        message: error.message,
        code: error.code
      }
    };
    console.log(JSON.stringify(errorResponse));
  }
});

async function handleRequest(request) {
  const { id, type } = request;

  try {
    if (type === 'task') {
      const { taskId, input } = request;

      const handler = taskHandlers.get(taskId);
      if (!handler) {
        return {
          id,
          ok: false,
          error: {
            message: `Task not found: ${taskId}`,
            code: 'NOT_FOUND'
          }
        };
      }

      const result = await handler(input);
      return {
        id,
        ok: true,
        result
      };
    }

    if (type === 'event') {
      const { eventId, payload } = request;

      const handler = eventHandlers.get(eventId);
      if (!handler) {
        return {
          id,
          ok: false,
          error: {
            message: `Event not found: ${eventId}`,
            code: 'NOT_FOUND'
          }
        };
      }

      await handler(payload);
      return {
        id,
        ok: true
      };
    }

    if (type === 'shutdown') {
      process.exit(0);
    }

    return {
      id,
      ok: false,
      error: {
        message: `Unknown request type: ${type}`,
        code: 'INVALID_REQUEST'
      }
    };
  } catch (error) {
    return {
      id,
      ok: false,
      error: {
        message: error.message,
        code: error.code || 'EXECUTION_ERROR'
      }
    };
  }
}

console.error('[Worker] Node.js worker started, waiting for requests...');
