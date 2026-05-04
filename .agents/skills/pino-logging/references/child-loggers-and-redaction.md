---
title: Child Loggers and Redaction
description: Child loggers with bindings, serializers for request/response/error objects, and redaction for sensitive data
tags:
  [child, bindings, serializers, redaction, redact, error, context, sensitive]
---

# Child Loggers and Redaction

## Child Loggers

Child loggers inherit parent configuration and permanently bind key-value pairs to every log they emit. This is pino's primary mechanism for request-scoped context.

```ts
import pino from 'pino';

const logger = pino();

const requestLogger = logger.child({
  requestId: 'abc-123',
  module: 'auth',
});

requestLogger.info('Processing request');
// {"level":30,"time":...,"requestId":"abc-123","module":"auth","msg":"Processing request"}
```

### Nested Children

Bindings accumulate through the chain:

```ts
const requestLogger = logger.child({ requestId: 'abc-123' });
const userLogger = requestLogger.child({ userId: 'user-456' });

userLogger.info('User action');
// {"level":30,"requestId":"abc-123","userId":"user-456","msg":"User action"}
```

### Child with Different Level

```ts
const debugChild = logger.child({ component: 'database' }, { level: 'debug' });
debugChild.debug('Query executed');
```

### msgPrefix Accumulation

```ts
const apiLogger = pino({ msgPrefix: '[API] ' });
const authLogger = apiLogger.child({}, { msgPrefix: '[Auth] ' });

authLogger.info('Token validated');
// msg: "[API] [Auth] Token validated"
```

## Serializers

Serializers transform objects before they are logged. They run synchronously and are keyed to field names.

### Standard Serializers

```ts
import pino from 'pino';

const logger = pino({
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});
```

| Serializer                | Serializes        | Output Fields                                             |
| ------------------------- | ----------------- | --------------------------------------------------------- |
| `pino.stdSerializers.req` | `IncomingMessage` | `method`, `url`, `headers`, `remoteAddress`, `remotePort` |
| `pino.stdSerializers.res` | `ServerResponse`  | `statusCode`, `headers`                                   |
| `pino.stdSerializers.err` | `Error`           | `type`, `message`, `stack`, `code`, `cause`               |

### Custom Serializers

```ts
const logger = pino({
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
      },
    }),
    user: (user) => ({
      id: user.id,
      username: user.username,
    }),
    err: pino.stdSerializers.err,
  },
});
```

### Error with Cause Chain

```ts
const cause = new Error('Database timeout');
const error = new Error('Operation failed', { cause });
(error as NodeJS.ErrnoException).code = 'ERR_OPERATION';

logger.error({ err: error }, 'Request failed');
// Serializes: type, message, stack, code, and cause chain
```

### Child Serializer Override

```ts
const child = logger.child(
  {},
  {
    serializers: {
      user: (user) => ({ id: user.id }),
    },
  },
);
```

## Redaction

Redaction removes or masks sensitive data before logging. Uses fast-json-stringify internally with near-zero overhead.

### Simple Path Array

```ts
const logger = pino({
  redact: ['password', 'creditCard', 'user.ssn', 'users[*].token'],
});

logger.info({ password: 'secret', name: 'John' }, 'User login');
// {"password":"[Redacted]","name":"John","msg":"User login"}
```

### Custom Censor

```ts
const logger = pino({
  redact: {
    paths: ['secret', 'data.apiKey', 'headers.authorization'],
    censor: '**REDACTED**',
  },
});
```

### Remove Keys Entirely

```ts
const logger = pino({
  redact: {
    paths: ['tempData', 'internal.*'],
    remove: true,
  },
});
```

### Dynamic Censor Function

```ts
const logger = pino({
  redact: {
    paths: ['email'],
    censor: (value: string) => {
      if (typeof value === 'string' && value.includes('@')) {
        return value.replace(/(.{2}).*(@.*)/, '$1***$2');
      }
      return '[Redacted]';
    },
  },
});

logger.info({ email: 'john.doe@example.com' }, 'Email sent');
// email: "jo***@example.com"
```

### Wildcard Patterns

| Pattern               | Matches                                   |
| --------------------- | ----------------------------------------- |
| `password`            | Top-level `password` field                |
| `user.ssn`            | Nested `ssn` inside `user`                |
| `users[*].token`      | `token` on every element in `users` array |
| `internal.*`          | All direct children of `internal`         |
| `path["with-hyphen"]` | Keys with special characters              |

### Common Redaction Paths

```ts
const logger = pino({
  redact: [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'headers.authorization',
    'headers.cookie',
    'body.password',
    'body.creditCard',
    'user.ssn',
    'user.dateOfBirth',
    '*.secret',
  ],
});
```

## streamWrite Hook

Post-serialization mutation for edge cases where redaction paths are not known ahead of time:

```ts
const logger = pino({
  hooks: {
    streamWrite(str) {
      return str.replace(
        /api[_-]?key['"]\s*:\s*['"][^'"]+['"]/gi,
        'apiKey":"[REMOVED]"',
      );
    },
  },
});
```
