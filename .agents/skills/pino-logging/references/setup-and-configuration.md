---
title: Setup and Configuration
description: Pino installation, basic usage, log levels, formatters, custom levels, timestamp options, and TypeScript types
tags: [setup, configuration, levels, formatters, typescript, options, base]
---

# Setup and Configuration

## Installation

```bash
pnpm add pino
pnpm add -D pino-pretty
```

## Basic Usage

```ts
import pino from 'pino';

const logger = pino();
logger.info('hello world');
// {"level":30,"time":1234567890,"pid":1234,"hostname":"my-host","msg":"hello world"}
```

## Configuration Options

```ts
import pino from 'pino';

const logger = pino({
  level: 'debug',
  name: 'my-app',
  base: { env: process.env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  msgPrefix: '[API] ',
});
```

### Key Options

| Option         | Type                  | Default             | Description                                     |
| -------------- | --------------------- | ------------------- | ----------------------------------------------- |
| `level`        | `string`              | `'info'`            | Minimum log level                               |
| `name`         | `string`              | —                   | Adds `name` field to every log                  |
| `base`         | `object \| null`      | `{ pid, hostname }` | Fields merged into every log; `null` to disable |
| `timestamp`    | `boolean \| function` | `true` (epoch ms)   | Timestamp format                                |
| `msgPrefix`    | `string`              | —                   | Prefix prepended to every `msg`                 |
| `formatters`   | `object`              | —                   | Transform level, bindings, or log objects       |
| `serializers`  | `object`              | —                   | Transform specific fields                       |
| `redact`       | `string[] \| object`  | —                   | Paths to redact from output                     |
| `transport`    | `object`              | —                   | Worker thread transport config                  |
| `customLevels` | `object`              | —                   | Additional log levels                           |
| `hooks`        | `object`              | —                   | `streamWrite` hook for post-serialization       |

## Log Levels

| Level    | Number | Method               |
| -------- | ------ | -------------------- |
| `fatal`  | 60     | `logger.fatal()`     |
| `error`  | 50     | `logger.error()`     |
| `warn`   | 40     | `logger.warn()`      |
| `info`   | 30     | `logger.info()`      |
| `debug`  | 20     | `logger.debug()`     |
| `trace`  | 10     | `logger.trace()`     |
| `silent` | —      | Disables all logging |

## Logging Methods

```ts
// Message only
logger.info('Server started');

// Object + message (object merged into log entry)
logger.info({ port: 3000, host: '0.0.0.0' }, 'Server started');

// Error logging (use `err` key for automatic serialization)
logger.error({ err: new Error('Connection failed') }, 'Database error');

// Error shorthand
logger.error(new Error('Database connection failed'));

// Printf-style interpolation
logger.info('User %s performed %s', username, action);
```

## Timestamp Options

```ts
import pino from 'pino';

// Epoch milliseconds (default)
pino();

// ISO 8601 string
pino({ timestamp: pino.stdTimeFunctions.isoTime });
// "time":"2024-01-15T10:30:00.000Z"

// Unix epoch seconds
pino({ timestamp: pino.stdTimeFunctions.epochTime });

// Disable timestamp
pino({ timestamp: false });

// Custom format
pino({
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});
```

## Formatters

Formatters transform the output structure before serialization.

```ts
const logger = pino({
  formatters: {
    level(label) {
      return { severity: label.toUpperCase() };
    },
    bindings(bindings) {
      return { pid: bindings.pid, host: bindings.hostname };
    },
    log(object) {
      return object;
    },
  },
});
```

### GCP / Cloud Logging Format

```ts
const logger = pino({
  formatters: {
    level(label) {
      return { severity: label.toUpperCase() };
    },
  },
  messageKey: 'message',
});
```

## Custom Levels

```ts
const logger = pino({
  customLevels: {
    http: 35,
    verbose: 15,
  },
});

logger.http('Request received');
logger.verbose('Detailed trace');
```

## TypeScript

Pino ships its own types — no `@types/pino` needed.

```ts
import pino, { type Logger, type LoggerOptions } from 'pino';

const options: LoggerOptions = {
  level: 'info',
  transport: { target: 'pino-pretty' },
};

const logger: Logger = pino(options);
```

### Custom Levels with TypeScript

```ts
const logger = pino<'http'>({
  customLevels: { http: 35 },
  level: 'http',
});
logger.http('Request received');
```

### Enforcing Structured Fields

```ts
declare module 'pino' {
  interface LogFnFields {
    requestId: string;
  }
}

logger.info({ requestId: 'abc-123' }, 'ok');
// logger.info({}, 'missing requestId'); // TypeScript error
```

## Environment-Based Configuration

```ts
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
```

## Async Destination

For high-throughput logging, use buffered async writes:

```ts
const logger = pino(
  pino.destination({
    dest: './app.log',
    minLength: 4096,
    sync: false,
  }),
);

// Flush before process exit
process.on('beforeExit', () => {
  logger.flush();
});
```
