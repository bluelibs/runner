#!/usr/bin/env node

/**
 * Node.js worker with FLEXIBLE AUTHENTICATION
 *
 * This demonstrates how to implement custom auth logic in Node.js
 * while Rust handles all HTTP concerns (CORS, routing, JSON parsing).
 *
 * Rust asks: "Is this request authorized?"
 * Node.js decides: Based on YOUR business logic!
 */

const readline = require('readline');

// ============================================================================
// AUTH STRATEGIES - Implement your custom logic here!
// ============================================================================

/**
 * Strategy 1: JWT Authentication
 */
async function authenticateJWT(context) {
  const authHeader = context.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } };
  }

  const token = authHeader.substring(7);

  try {
    // In real code: verify JWT with secret, check expiration, etc.
    // const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Mock: just check if it looks like a JWT
    if (token.split('.').length === 3) {
      console.error('[Auth] JWT valid:', token.substring(0, 20) + '...');
      return { ok: true };
    }

    return { ok: false, error: { code: 401, codeName: 'INVALID_TOKEN', message: 'Invalid JWT token' } };
  } catch (error) {
    return { ok: false, error: { code: 401, codeName: 'INVALID_TOKEN', message: error.message } };
  }
}

/**
 * Strategy 2: API Key Authentication
 */
async function authenticateAPIKey(context) {
  const apiKey = context.headers['x-api-key'];

  if (!apiKey) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing API key' } };
  }

  // In real code: check against database, rate limit by key, etc.
  const validKeys = new Set([
    'key_test_123',
    'key_prod_456',
    'key_admin_789',
  ]);

  if (validKeys.has(apiKey)) {
    console.error('[Auth] API key valid:', apiKey);
    return { ok: true };
  }

  return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: 'Invalid API key' } };
}

/**
 * Strategy 3: Custom Multi-Factor Auth
 */
async function authenticateCustom(context) {
  const sessionId = context.headers['x-session-id'];
  const userId = context.headers['x-user-id'];

  if (!sessionId || !userId) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing session credentials' } };
  }

  // In real code: check session in Redis, verify user permissions, etc.
  // const session = await redis.get(`session:${sessionId}`);
  // const user = await db.users.findById(userId);

  console.error('[Auth] Custom auth - Session:', sessionId, 'User:', userId);

  // Mock: allow specific user IDs
  const allowedUsers = ['user123', 'admin456'];
  if (allowedUsers.includes(userId)) {
    return { ok: true };
  }

  return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: 'User not authorized' } };
}

/**
 * Strategy 4: OAuth / Third-Party Auth
 */
async function authenticateOAuth(context) {
  const token = context.headers['authorization']?.replace('Bearer ', '');

  if (!token) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing OAuth token' } };
  }

  // In real code: verify token with OAuth provider (Google, GitHub, etc.)
  // const userInfo = await fetch('https://oauth.provider.com/verify', {
  //   headers: { Authorization: `Bearer ${token}` }
  // });

  console.error('[Auth] OAuth token:', token.substring(0, 20) + '...');

  // Mock: accept any token longer than 20 chars
  if (token.length > 20) {
    return { ok: true };
  }

  return { ok: false, error: { code: 401, codeName: 'INVALID_TOKEN', message: 'Invalid OAuth token' } };
}

/**
 * Strategy 5: Role-Based Access Control (RBAC)
 */
async function authenticateRBAC(context, taskId) {
  const userId = context.headers['x-user-id'];
  const userRole = context.headers['x-user-role'];

  if (!userId || !userRole) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing user credentials' } };
  }

  // Define which roles can access which tasks
  const permissions = {
    'admin': ['*'],  // Admin can do everything
    'user': ['app.tasks.greet', 'app.tasks.echo'],
    'guest': ['app.tasks.greet'],
  };

  const allowedTasks = permissions[userRole] || [];

  if (allowedTasks.includes('*') || allowedTasks.includes(taskId)) {
    console.error('[Auth] RBAC - User:', userId, 'Role:', userRole, 'Task:', taskId, '✓');
    return { ok: true };
  }

  return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: `Role '${userRole}' cannot access '${taskId}'` } };
}

// ============================================================================
// MAIN AUTH HANDLER - Choose your strategy!
// ============================================================================

async function handleAuth(context, taskId) {
  // You can implement routing logic here based on headers, paths, etc.

  // Example 1: Route by header
  if (context.headers['x-auth-type'] === 'jwt') {
    return await authenticateJWT(context);
  }

  if (context.headers['x-api-key']) {
    return await authenticateAPIKey(context);
  }

  // Example 2: Use RBAC for task-specific auth
  if (taskId && context.headers['x-user-role']) {
    return await authenticateRBAC(context, taskId);
  }

  // Example 3: Default to OAuth
  if (context.headers['authorization']) {
    return await authenticateOAuth(context);
  }

  // No auth provided
  return {
    ok: false,
    error: {
      code: 401,
      codeName: 'UNAUTHORIZED',
      message: 'No authentication credentials provided'
    }
  };
}

// ============================================================================
// TASK HANDLERS - Your business logic
// ============================================================================

const taskHandlers = new Map();

taskHandlers.set('app.tasks.add', async (input, context) => {
  const a = input.a || 0;
  const b = input.b || 0;
  console.error('[Task] add:', a, '+', b, '=', a + b);
  return a + b;
});

taskHandlers.set('app.tasks.greet', async (input, context) => {
  const name = input.name || 'World';
  const userId = context.headers['x-user-id'] || 'anonymous';
  const greeting = `Hello, ${name}! (from user: ${userId})`;
  console.error('[Task] greet:', greeting);
  return greeting;
});

taskHandlers.set('app.tasks.echo', async (input, context) => {
  console.error('[Task] echo:', input);
  return input;
});

taskHandlers.set('app.tasks.admin.delete', async (input, context) => {
  // This task should only be accessible to admins (via RBAC)
  console.error('[Task] ADMIN DELETE:', input);
  return { deleted: true, timestamp: new Date().toISOString() };
});

// ============================================================================
// EVENT HANDLERS
// ============================================================================

const eventHandlers = new Map();

eventHandlers.set('app.events.notify', async (payload, context) => {
  console.error('[Event] notify:', payload);
});

eventHandlers.set('app.events.log', async (payload, context) => {
  console.error('[Event] log:', payload.message);
});

// ============================================================================
// IPC COMMUNICATION
// ============================================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    console.log(JSON.stringify(response));
  } catch (error) {
    console.error('[Worker Error]', error);
    const errorResponse = {
      id: 0,
      ok: false,
      error: {
        message: error.message,
        code: 500,
        codeName: 'INTERNAL_ERROR'
      }
    };
    console.log(JSON.stringify(errorResponse));
  }
});

async function handleRequest(request) {
  const { id, type } = request;

  try {
    // AUTH REQUEST - Rust is asking: "Is this authorized?"
    if (type === 'auth') {
      const authResult = await handleAuth(request.context);
      return {
        id,
        ...authResult
      };
    }

    // TASK REQUEST - Execute with context
    if (type === 'task') {
      const { taskId, input, context } = request;

      const handler = taskHandlers.get(taskId);
      if (!handler) {
        return {
          id,
          ok: false,
          error: {
            message: `Task not found: ${taskId}`,
            code: 404,
            codeName: 'NOT_FOUND'
          }
        };
      }

      const result = await handler(input, context);
      return {
        id,
        ok: true,
        result
      };
    }

    // EVENT REQUEST
    if (type === 'event') {
      const { eventId, payload, context } = request;

      const handler = eventHandlers.get(eventId);
      if (!handler) {
        return {
          id,
          ok: false,
          error: {
            message: `Event not found: ${eventId}`,
            code: 404,
            codeName: 'NOT_FOUND'
          }
        };
      }

      await handler(payload, context);
      return {
        id,
        ok: true
      };
    }

    // SHUTDOWN
    if (type === 'shutdown') {
      process.exit(0);
    }

    return {
      id,
      ok: false,
      error: {
        message: `Unknown request type: ${type}`,
        code: 400,
        codeName: 'INVALID_REQUEST'
      }
    };
  } catch (error) {
    return {
      id,
      ok: false,
      error: {
        message: error.message,
        code: 500,
        codeName: 'EXECUTION_ERROR'
      }
    };
  }
}

console.error('[Worker] Node.js worker started with FLEXIBLE AUTH');
console.error('[Worker] Supported auth strategies:');
console.error('  - JWT (Authorization: Bearer <token>)');
console.error('  - API Key (x-api-key: <key>)');
console.error('  - Custom (x-session-id + x-user-id)');
console.error('  - OAuth (Authorization: Bearer <token>)');
console.error('  - RBAC (x-user-role + x-user-id)');
console.error('[Worker] Waiting for requests...');
