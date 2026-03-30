FROM oven/bun:1.3.10 AS base
WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.json .oxlintrc.jsonc .oxfmtrc.jsonc ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --frozen-lockfile

WORKDIR /app/apps/connector
CMD ["bun", "run", "start"]
