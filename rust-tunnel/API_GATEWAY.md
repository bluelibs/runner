# Using Tunnel as an API Gateway

The Rust tunnel server can act as a **high-performance API gateway** with flexible authentication, routing, and middleware capabilities.

## What is an API Gateway?

An API gateway is a server that acts as a single entry point for multiple backend services:

```
Clients → [API Gateway] → Backend Service 1
                       → Backend Service 2
                       → Backend Service 3
```

**Functions:**
- **Routing**: Direct requests to appropriate services
- **Authentication**: Verify credentials before reaching backends
- **Rate Limiting**: Prevent abuse
- **CORS**: Handle cross-origin requests
- **Logging**: Track all API usage
- **Transformation**: Modify requests/responses

## Tunnel as API Gateway

```
HTTP Clients → [Rust Tunnel Server] → [Node.js Worker]
                     ↓                      ↓
                 HTTP/CORS              Your Services
                 Auth                   Service routing
                 JSON                   Business logic
                 Rate limit
```

**Benefits:**
- ⚡ **Fast**: Rust handles HTTP (10,000+ req/s)
- 🔒 **Secure**: Custom auth in Node.js
- 🔌 **Flexible**: Route to any service
- 🎯 **Simple**: One gateway, multiple backends

## Use Cases

### 1. Expose Multiple APIs

```javascript
// Route different tasks to different services

taskHandlers.set('users.create', async (input, context) => {
  // Forward to user service
  return await userService.createUser(input);
});

taskHandlers.set('payments.process', async (input, context) => {
  // Forward to payment service
  return await paymentService.process(input);
});

taskHandlers.set('analytics.track', async (input, context) => {
  // Forward to analytics service
  return await analyticsService.track(input);
});
```

**Result:**
```
POST /__runner/task/users.create      → User Service
POST /__runner/task/payments.process  → Payment Service
POST /__runner/task/analytics.track   → Analytics Service
```

### 2. Connect Internal Services

```javascript
// Allow services to call each other via the gateway

taskHandlers.set('orders.create', async (input, context) => {
  // 1. Create order in database
  const order = await db.orders.insert(input);

  // 2. Call payment service via gateway
  await callTask('payments.charge', {
    orderId: order.id,
    amount: order.total
  });

  // 3. Call notification service via gateway
  await callTask('notifications.send', {
    userId: order.userId,
    message: 'Order created'
  });

  return order;
});
```

### 3. Public + Private APIs

```javascript
async function handleAuth(context, taskId) {
  // Public endpoints (no auth)
  const publicApis = [
    'public.health',
    'public.version',
    'public.docs',
  ];

  if (publicApis.includes(taskId)) {
    return { ok: true };
  }

  // Internal endpoints (service-to-service)
  const internalApis = [
    'internal.sync',
    'internal.cache.clear',
  ];

  if (internalApis.includes(taskId)) {
    // Check service token
    const serviceToken = context.headers['x-service-token'];
    if (serviceToken === process.env.SERVICE_TOKEN) {
      return { ok: true };
    }
    return { ok: false, error: { code: 403, codeName: 'FORBIDDEN', message: 'Invalid service token' } };
  }

  // User endpoints (JWT auth)
  return await authenticateJWT(context);
}
```

### 4. API Versioning

```javascript
taskHandlers.set('v1.users.get', async (input) => {
  // Old API format
  const user = await db.users.findById(input.id);
  return {
    id: user.id,
    name: user.name
  };
});

taskHandlers.set('v2.users.get', async (input) => {
  // New API format with more fields
  const user = await db.users.findById(input.id);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created: user.createdAt,
    profile: user.profile
  };
});
```

**Usage:**
```bash
# Old clients
curl -X POST http://api.com/__runner/task/v1.users.get \
  -d '{"input": {"id": "123"}}'

# New clients
curl -X POST http://api.com/__runner/task/v2.users.get \
  -d '{"input": {"id": "123"}}'
```

### 5. Rate Limiting

```javascript
const rateLimits = new Map();

async function checkRateLimit(userId) {
  const key = `rate:${userId}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 100;

  const requests = rateLimits.get(key) || [];
  const recentRequests = requests.filter(t => now - t < windowMs);

  if (recentRequests.length >= maxRequests) {
    return {
      ok: false,
      error: {
        code: 429,
        codeName: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded'
      }
    };
  }

  recentRequests.push(now);
  rateLimits.set(key, recentRequests);
  return { ok: true };
}

async function handleAuth(context, taskId) {
  // First: authenticate
  const authResult = await authenticateJWT(context);
  if (!authResult.ok) return authResult;

  // Extract user from JWT
  const token = context.headers['authorization'].substring(7);
  const decoded = jwt.decode(token);

  // Then: check rate limit
  return await checkRateLimit(decoded.sub);
}
```

### 6. Request Logging & Analytics

```javascript
async function handleRequest(request) {
  const startTime = Date.now();

  try {
    // Execute task
    const response = await executeTask(request);

    // Log successful request
    await logRequest({
      taskId: request.taskId,
      userId: extractUserId(request.context),
      duration: Date.now() - startTime,
      status: 'success',
      timestamp: new Date()
    });

    return response;
  } catch (error) {
    // Log failed request
    await logRequest({
      taskId: request.taskId,
      userId: extractUserId(request.context),
      duration: Date.now() - startTime,
      status: 'error',
      error: error.message,
      timestamp: new Date()
    });

    throw error;
  }
}
```

### 7. GraphQL Gateway

Forward GraphQL queries:

```javascript
taskHandlers.set('graphql.query', async (input, context) => {
  const { query, variables } = input;

  // Forward to GraphQL server
  const response = await fetch('http://graphql-server:4000/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Forward auth
      'Authorization': context.headers['authorization']
    },
    body: JSON.stringify({ query, variables })
  });

  return await response.json();
});
```

### 8. Webhook Proxy

```javascript
taskHandlers.set('webhooks.github', async (input, context) => {
  // Validate GitHub signature
  const signature = context.headers['x-hub-signature-256'];
  if (!validateGitHubSignature(signature, input)) {
    throw new Error('Invalid signature');
  }

  // Process webhook
  if (input.action === 'opened') {
    await handlePROpened(input.pull_request);
  }

  return { ok: true };
});
```

## Architecture Patterns

### Microservices Gateway

```
                        [Rust Tunnel]
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
    [User Service]    [Payment Service]   [Email Service]
    Node.js/Express   Python/Flask        Go/HTTP
```

```javascript
// Gateway routes to different services

taskHandlers.set('users.*', async (input, context) => {
  const response = await fetch('http://user-service:3000', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Authorization': context.headers['authorization'] }
  });
  return await response.json();
});

taskHandlers.set('payments.*', async (input, context) => {
  const response = await fetch('http://payment-service:8000', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return await response.json();
});
```

### BFF (Backend for Frontend)

Different APIs for different clients:

```javascript
taskHandlers.set('mobile.dashboard', async (input, context) => {
  // Optimized for mobile (less data)
  const data = await fetchDashboardData(input.userId);
  return {
    summary: data.summary,
    recentItems: data.recent.slice(0, 5) // Only 5 items
  };
});

taskHandlers.set('web.dashboard', async (input, context) => {
  // Full data for web
  const data = await fetchDashboardData(input.userId);
  return {
    summary: data.summary,
    recentItems: data.recent,
    charts: data.charts,
    analytics: data.analytics
  };
});
```

### Service Mesh Entry Point

```
External → [Rust Tunnel] → [Service Mesh]
                               ├─ Service A
                               ├─ Service B
                               └─ Service C
```

## Performance Characteristics

| Component | Latency | Notes |
|-----------|---------|-------|
| Rust HTTP handling | ~0.1ms | Extremely fast |
| IPC to Node.js | ~0.1ms | Direct pipes |
| Node.js auth logic | ~1-5ms | Depends on complexity |
| Service forwarding | ~5-50ms | Depends on backend |
| **Total overhead** | **~1-5ms** | Minimal! |

## Deployment

### Docker Compose

```yaml
version: '3.8'

services:
  gateway:
    build: ./rust-tunnel
    ports:
      - "7070:7070"
    environment:
      - JWT_SECRET=${JWT_SECRET}
      - SERVICE_TOKEN=${SERVICE_TOKEN}
    depends_on:
      - user-service
      - payment-service

  user-service:
    image: my-user-service:latest
    ports:
      - "3000:3000"

  payment-service:
    image: my-payment-service:latest
    ports:
      - "8000:8000"
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: rust-tunnel
        image: rust-tunnel:latest
        ports:
        - containerPort: 7070
        env:
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: jwt-secret
---
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 7070
  selector:
    app: api-gateway
```

## Monitoring

```javascript
// Track API metrics

const metrics = {
  requests: new Map(),
  errors: new Map(),
  latencies: []
};

async function trackMetrics(taskId, duration, success) {
  // Count requests
  const count = metrics.requests.get(taskId) || 0;
  metrics.requests.set(taskId, count + 1);

  // Count errors
  if (!success) {
    const errors = metrics.errors.get(taskId) || 0;
    metrics.errors.set(taskId, errors + 1);
  }

  // Track latency
  metrics.latencies.push({ taskId, duration, timestamp: Date.now() });

  // Keep only last hour
  const oneHourAgo = Date.now() - 3600000;
  metrics.latencies = metrics.latencies.filter(l => l.timestamp > oneHourAgo);
}

// Expose metrics endpoint
taskHandlers.set('internal.metrics', async () => {
  return {
    requests: Object.fromEntries(metrics.requests),
    errors: Object.fromEntries(metrics.errors),
    avgLatency: metrics.latencies.reduce((a, b) => a + b.duration, 0) / metrics.latencies.length
  };
});
```

## Summary

The Rust tunnel server makes an excellent API gateway:

✅ **Fast HTTP handling** (Rust)
✅ **Flexible routing** (Node.js)
✅ **Custom auth** (your choice: JWT, OAuth, etc.)
✅ **Service composition** (call multiple backends)
✅ **Rate limiting** (your logic)
✅ **Monitoring** (track everything)
✅ **Easy deployment** (single binary + worker script)

**Use it to:**
- Expose multiple microservices via one endpoint
- Add auth/rate limiting to any backend
- Version your APIs
- Create BFF patterns
- Build service mesh entry points
- Replace traditional API gateways (Kong, NGINX, etc.)

**With better performance and full control!** 🚀
