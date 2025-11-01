# Authentication Strategies

This document shows how to implement different authentication strategies in Node.js while Rust handles HTTP.

## Architecture

```
HTTP Request → [Rust]                    → [Node.js Worker]
                  ↓                           ↓
              HTTP/CORS                    YOUR Auth Logic
              JSON parsing              ───────────────────
              Routing                   • JWT verification
                                       • API key lookup
              Asks: "Authorized?"      • Database checks
                                       • OAuth validation
                                       • RBAC permissions
                                       • Custom logic
```

## Flow

1. **HTTP Request** arrives at Rust with auth headers
2. **Rust** extracts headers, sends to Node.js: "Is this authorized?"
3. **Node.js** implements YOUR auth logic (JWT, OAuth, DB, etc.)
4. **Node.js** responds: "Yes" or "No + error"
5. **Rust** either continues to task or returns 401/403
6. If authorized, **Rust** forwards task to **Node.js** for execution
7. **Node.js** executes and returns result
8. **Rust** returns HTTP response

## Benefits

✅ **Flexible**: Implement ANY auth logic in Node.js
✅ **Fast**: Rust handles HTTP overhead
✅ **Secure**: Auth logic in your familiar Node.js code
✅ **Maintainable**: Change auth without touching Rust
✅ **Powerful**: Access to full Node.js ecosystem (JWT libs, DB clients, etc.)

## Example 1: JWT Authentication

```javascript
// node-worker-flexible-auth.js

async function authenticateJWT(context) {
  const authHeader = context.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing token' }
    };
  }

  const token = authHeader.substring(7);

  try {
    // Verify JWT with your secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check expiration, permissions, etc.
    if (decoded.exp < Date.now() / 1000) {
      return { ok: false, error: { code: 401, codeName: 'TOKEN_EXPIRED', message: 'Token expired' } };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: { code: 401, codeName: 'INVALID_TOKEN', message: error.message } };
  }
}
```

**Usage:**
```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIs...' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'
```

## Example 2: API Key Authentication

```javascript
async function authenticateAPIKey(context) {
  const apiKey = context.headers['x-api-key'];

  if (!apiKey) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing API key' } };
  }

  // Check against database
  const key = await db.apiKeys.findOne({ key: apiKey, active: true });

  if (!key) {
    return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: 'Invalid API key' } };
  }

  // Update usage stats
  await db.apiKeys.updateOne(
    { _id: key._id },
    { $inc: { requestCount: 1 }, $set: { lastUsed: new Date() } }
  );

  return { ok: true };
}
```

**Usage:**
```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-api-key: key_test_123' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'
```

## Example 3: OAuth / Third-Party Auth

```javascript
async function authenticateOAuth(context) {
  const token = context.headers['authorization']?.replace('Bearer ', '');

  if (!token) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing token' } };
  }

  // Verify with OAuth provider (Google, GitHub, etc.)
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      return { ok: false, error: { code: 401, codeName: 'INVALID_TOKEN', message: 'Invalid OAuth token' } };
    }

    const userInfo = await response.json();

    // Check if user is authorized
    if (!userInfo.email_verified) {
      return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: 'Email not verified' } };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: { code: 500, codeName: 'INTERNAL_ERROR', message: error.message } };
  }
}
```

**Usage:**
```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'Authorization: Bearer ya29.a0AfH6SMBx...' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'
```

## Example 4: Role-Based Access Control (RBAC)

```javascript
async function authenticateRBAC(context, taskId) {
  const userId = context.headers['x-user-id'];
  const userRole = context.headers['x-user-role'];

  if (!userId || !userRole) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing credentials' } };
  }

  // Define permissions
  const permissions = {
    'admin': ['*'],  // Admin can do everything
    'user': ['app.tasks.greet', 'app.tasks.echo', 'app.tasks.add'],
    'guest': ['app.tasks.greet'],
  };

  const allowedTasks = permissions[userRole] || [];

  if (allowedTasks.includes('*') || allowedTasks.includes(taskId)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: {
      code: 403,
      codeName: 'FORBIDDEN',
      message: `Role '${userRole}' cannot access '${taskId}'`
    }
  };
}
```

**Usage:**
```bash
# Admin can access everything
curl -X POST http://localhost:7070/__runner/task/app.tasks.admin.delete \
  -H 'x-user-id: admin123' \
  -H 'x-user-role: admin' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"id": "xyz"}}'

# User can access limited tasks
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-user-id: user456' \
  -H 'x-user-role: user' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'

# Guest can only greet
curl -X POST http://localhost:7070/__runner/task/app.tasks.greet \
  -H 'x-user-id: guest789' \
  -H 'x-user-role: guest' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"name": "World"}}'
```

## Example 5: Database Session Auth

```javascript
async function authenticateSession(context) {
  const sessionId = context.headers['x-session-id'];

  if (!sessionId) {
    return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Missing session' } };
  }

  // Check session in database (or Redis)
  const session = await db.sessions.findOne({
    sessionId,
    expiresAt: { $gt: new Date() }
  });

  if (!session) {
    return { ok: false, error: { code: 401, codeName: 'INVALID_SESSION', message: 'Session expired or invalid' } };
  }

  // Update last activity
  await db.sessions.updateOne(
    { _id: session._id },
    { $set: { lastActivity: new Date() } }
  );

  return { ok: true };
}
```

## Example 6: Multi-Strategy Router

Combine multiple strategies:

```javascript
async function handleAuth(context, taskId) {
  // Route based on headers
  if (context.headers['authorization']?.startsWith('Bearer ')) {
    // Could be JWT or OAuth - check format
    const token = context.headers['authorization'].substring(7);
    if (token.split('.').length === 3) {
      return await authenticateJWT(context);
    } else {
      return await authenticateOAuth(context);
    }
  }

  if (context.headers['x-api-key']) {
    return await authenticateAPIKey(context);
  }

  if (context.headers['x-session-id']) {
    return await authenticateSession(context);
  }

  if (context.headers['x-user-role']) {
    return await authenticateRBAC(context, taskId);
  }

  return {
    ok: false,
    error: { code: 401, codeName: 'UNAUTHORIZED', message: 'No auth provided' }
  };
}
```

## API Gateway Use Case

Use the tunnel as an API gateway with custom routing:

```javascript
async function handleAuth(context, taskId) {
  // Public endpoints (no auth required)
  const publicEndpoints = [
    'app.tasks.health',
    'app.tasks.version',
    'app.tasks.public.info',
  ];

  if (publicEndpoints.includes(taskId)) {
    return { ok: true };
  }

  // Admin-only endpoints
  const adminEndpoints = [
    'app.tasks.admin.users',
    'app.tasks.admin.settings',
  ];

  if (adminEndpoints.includes(taskId)) {
    const role = context.headers['x-user-role'];
    if (role !== 'admin') {
      return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: 'Admin only' } };
    }
  }

  // Regular auth for all other endpoints
  if (context.headers['authorization']) {
    return await authenticateJWT(context);
  }

  return { ok: false, error: { code: 401, codeName: 'UNAUTHORIZED', message: 'Auth required' } };
}
```

## Configuration

Enable delegated auth in Rust config:

```rust
let config = TunnelConfig {
    delegate_auth: true,  // Let Node.js handle auth
    // ... other config
};
```

Or use Rust auth (simple token check):

```rust
let config = TunnelConfig {
    delegate_auth: false,  // Rust handles simple token auth
    auth_token: "secret".to_string(),
    // ... other config
};
```

## Error Codes

Node.js can return any error code:

```javascript
return {
  ok: false,
  error: {
    code: 401,           // HTTP status code
    codeName: 'UNAUTHORIZED',
    message: 'Detailed error message'
  }
};
```

Common codes:
- **401**: Unauthorized (invalid/missing credentials)
- **403**: Forbidden (valid credentials but insufficient permissions)
- **429**: Too Many Requests (rate limiting)
- **500**: Internal Error (auth system error)

## Testing

```bash
# Test JWT auth
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-auth-type: jwt' \
  -H 'Authorization: Bearer eyJhbGci.eyJzdWIi.SflKxw' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'

# Test API key auth
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-api-key: key_test_123' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'

# Test RBAC
curl -X POST http://localhost:7070/__runner/task/app.tasks.admin.delete \
  -H 'x-user-id: admin123' \
  -H 'x-user-role: admin' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"id": "xyz"}}'
```

## Summary

**Key Points:**

1. **Rust handles HTTP** (fast, efficient)
2. **Node.js handles auth** (YOUR logic, YOUR rules)
3. **Full context forwarded** (headers, path, method)
4. **Any auth strategy** (JWT, OAuth, DB, custom, etc.)
5. **Easy to extend** (just Node.js code)
6. **Acts as API gateway** (routing, auth, rate limiting, etc.)

**This is the power of the tunnel architecture!** 🚀
