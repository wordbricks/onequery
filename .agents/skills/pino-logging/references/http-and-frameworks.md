---
title: HTTP and Frameworks
description: pino-http middleware, request correlation IDs, and integrations with Fastify, Hono, and Express
tags:
  [
    pino-http,
    fastify,
    hono,
    express,
    request-id,
    correlation,
    middleware,
    framework,
  ]
---

# HTTP and Frameworks

## pino-http

Automatic HTTP request/response logging as middleware.

```bash
pnpm add pino-http
```

### Express

```ts
import express from 'express';
import pinoHttp from 'pino-http';

const app = express();
app.use(pinoHttp());

app.get('/users/:id', (req, res) => {
  req.log.info({ userId: req.params.id }, 'fetching user');
  res.json({ id: req.params.id });
});
```

Each completed request automatically logs `req`, `res`, `responseTime` (ms), and `msg: "request completed"`.

### Request ID Generation

```ts
import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';

app.use(
  pinoHttp({
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'] as string;
      if (existing) return existing;
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
  }),
);
```

### Custom Attribute Keys

```ts
app.use(
  pinoHttp({
    customAttributeKeys: {
      req: 'request',
      res: 'response',
      err: 'error',
      responseTime: 'duration',
      reqId: 'requestId',
    },
  }),
);
```

### Custom Log Level per Response

```ts
app.use(
  pinoHttp({
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }),
);
```

### Request Body Logging with Redaction

```ts
app.use(
  pinoHttp({
    serializers: {
      req(req) {
        const serialized = pinoHttp.stdSerializers.req(req);
        serialized.body = req.raw.body;
        if (serialized.body?.password) {
          serialized.body = { ...serialized.body, password: '[REDACTED]' };
        }
        return serialized;
      },
    },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
  }),
);
```

### Quiet Routes

Skip logging for health checks and static assets:

```ts
app.use(
  pinoHttp({
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? '';
        return url === '/health' || url.startsWith('/static/');
      },
    },
  }),
);
```

## Fastify (Built-in)

Fastify ships with pino as its built-in logger. No extra package needed.

```ts
import Fastify from 'fastify';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
    redact: ['req.headers.authorization'],
  },
});

fastify.get('/users/:id', async (request, reply) => {
  request.log.info({ userId: request.params.id }, 'fetching user');
  return { id: request.params.id };
});
```

Fastify automatically:

- Generates a request ID (from `requestIdHeader` or incremental)
- Logs request received and response sent with `responseTime`
- Provides `request.log` as a child logger with request bindings

### Custom Request ID

```ts
const fastify = Fastify({
  logger: true,
  requestIdHeader: 'x-request-id',
  genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
});
```

## Hono

Use `hono-pino` for pino integration:

```bash
pnpm add hono-pino pino
```

```ts
import { Hono } from 'hono';
import { pinoLogger } from 'hono-pino';
import pino from 'pino';

const app = new Hono();

app.use(
  pinoLogger({
    pino: pino({ level: 'info' }),
  }),
);

app.get('/', (c) => {
  c.get('logger').info('handling root');
  return c.text('ok');
});
```

For development, `hono-pino` provides a built-in debug transport:

```ts
import { pinoLogger } from 'hono-pino';
import debugLog from 'hono-pino/debug-log';

app.use(
  pinoLogger({
    pino: pino({
      level: 'debug',
      transport: { target: debugLog },
    }),
  }),
);
```

## Request Tracing Pattern

Use child loggers for request-scoped context that flows through all service calls:

```ts
import express from 'express';
import pino from 'pino';
import { randomUUID } from 'crypto';

const logger = pino();
const app = express();

app.use((req, _res, next) => {
  req.log = logger.child({
    requestId: (req.headers['x-request-id'] as string) ?? randomUUID(),
    method: req.method,
    url: req.url,
  });
  next();
});

app.get('/orders', async (req, res) => {
  req.log.info('fetching orders');
  const orders = await getOrders(req.log);
  req.log.info({ count: orders.length }, 'orders fetched');
  res.json(orders);
});

async function getOrders(log: pino.Logger) {
  log.info('querying database');
  const result = await db.query('SELECT * FROM orders');
  log.info({ rows: result.length }, 'query complete');
  return result;
}
```

## Structured Error Logging

```ts
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    req.log.error(
      {
        err,
        userId: req.user?.id,
        operation: `${req.method} ${req.path}`,
      },
      'Unhandled error',
    );

    res.status(500).json({ error: 'Internal server error' });
  },
);
```

## Framework Comparison

| Framework | Package           | Logger Access     | Request ID          | Auto Logging |
| --------- | ----------------- | ----------------- | ------------------- | ------------ |
| Fastify   | Built-in          | `request.log`     | Auto (configurable) | Yes          |
| Express   | `pino-http`       | `req.log`         | Via `genReqId`      | Yes          |
| Hono      | `hono-pino`       | `c.get('logger')` | Via middleware      | Yes          |
| NestJS    | `nestjs-pino`     | `Logger` DI       | Via `genReqId`      | Yes          |
| Koa       | `koa-pino-logger` | `ctx.log`         | Via `genReqId`      | Yes          |
