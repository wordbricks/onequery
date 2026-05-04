---
title: Transports
description: Worker thread transports, multi-destination routing, file logging, rotating files, pipeline transports, and pino-pretty
tags:
  [
    transport,
    worker-thread,
    pino-pretty,
    file,
    pino-roll,
    rotating,
    pipeline,
    multi,
    destination,
  ]
---

# Transports

Transports run in worker threads via `pino.transport()`, keeping the main event loop free from I/O. The main thread serializes JSON and passes it through a shared buffer.

## Single Transport

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});
```

## File Transport (Built-in)

```ts
const logger = pino({
  transport: {
    target: 'pino/file',
    options: {
      destination: '/var/log/app.log',
      mkdir: true,
    },
  },
});
```

## Multiple Transports

Route logs to different destinations based on level:

```ts
const logger = pino({
  level: 'debug',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        level: 'info',
        options: { destination: 1 },
      },
      {
        target: 'pino/file',
        level: 'error',
        options: { destination: '/var/log/error.log' },
      },
      {
        target: 'pino/file',
        level: 'debug',
        options: { destination: '/var/log/debug.log' },
      },
    ],
  },
});
```

Each target filters independently — a log at `error` level goes to both the `info`+ and `error`+ destinations.

## Pipeline Transport

Chain transforms before sending to a destination:

```ts
const logger = pino({
  transport: {
    pipeline: [
      { target: 'pino-syslog' },
      {
        target: 'pino-socket',
        options: { address: 'syslog.example.com', port: 514 },
      },
    ],
  },
});
```

## Rotating File Transport (pino-roll)

```bash
pnpm add pino-roll
```

```ts
const logger = pino({
  transport: {
    target: 'pino-roll',
    options: {
      file: '/var/log/app.log',
      frequency: 'daily',
      size: '10m',
      limit: { count: 7 },
    },
  },
});
```

### pino-roll Options

| Option        | Type               | Description                                   |
| ------------- | ------------------ | --------------------------------------------- |
| `file`        | `string`           | Log file path (rotation number appended)      |
| `size`        | `string \| number` | Max file size before rotation (e.g., `'10m'`) |
| `frequency`   | `string`           | Time-based rotation (`'daily'`, `'hourly'`)   |
| `limit.count` | `number`           | Rotated files to retain (plus active file)    |
| `dateFormat`  | `string`           | Date format appended to filename              |

## Using pino.transport() Directly

For more control, create a transport instance:

```ts
import pino from 'pino';

const transport = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: { destination: './app.log' },
    },
    {
      target: 'pino-pretty',
      options: { destination: 1 },
    },
  ],
});

const logger = pino(transport);
```

## Custom Transport

Write a custom transport as a module that exports a function:

```ts
// my-transport.ts
import build from 'pino-abstract-transport';

export default async function (opts: { url: string }) {
  return build(async function (source) {
    for await (const obj of source) {
      await fetch(opts.url, {
        method: 'POST',
        body: JSON.stringify(obj),
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}
```

```ts
const logger = pino({
  transport: {
    target: './my-transport.ts',
    options: { url: 'https://logs.example.com/ingest' },
  },
});
```

## Transport Comparison

| Transport                | Package                  | Use Case                  |
| ------------------------ | ------------------------ | ------------------------- |
| `pino-pretty`            | `pino-pretty`            | Human-readable dev output |
| `pino/file`              | Built-in                 | Simple file logging       |
| `pino-roll`              | `pino-roll`              | Rotating file logs        |
| `pino-socket`            | `pino-socket`            | TCP/UDP log shipping      |
| `pino-syslog`            | `pino-syslog`            | Syslog protocol           |
| `pino-elasticsearch`     | `pino-elasticsearch`     | Elasticsearch ingest      |
| `pino-datadog-transport` | `pino-datadog-transport` | Datadog log shipping      |

## Production Recommendations

- Never use `pino-pretty` in production — JSON output is parsed by log aggregators
- Use multi-target transports to split error logs from info logs
- Set `sync: false` on `pino.destination()` for high-throughput apps
- Prefer piping (`node app.js | pino-pretty`) over in-process pretty printing for dev
