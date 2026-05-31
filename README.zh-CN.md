# OneQuery

<p align="center">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@onequery/cli"><img src="https://img.shields.io/npm/dm/@onequery/cli?style=flat-square" alt="npm downloads"></a>
  <a href="https://onequery.dev"><img src="https://img.shields.io/badge/Site-onequery.dev-blue?style=flat-square" alt="Site"></a>
  <a href="https://github.com/wordbricks/onequery/releases"><img src="https://img.shields.io/github/v/release/wordbricks/onequery?display_name=release&style=flat-square" alt="Release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/wordbricks/onequery?style=flat-square" alt="License"></a>
</p>

**自部署 OneQuery，把数据库、分析工具和 API 接入同一个入口，统一管理凭证，在 CLI 和 Web 上跑安全、可审计的查询。**

一个入口搞定整套数据，内置安全防护，团队协作更顺手。

---

## 功能

| | 自部署 | 云端 / 企业版 |
|---|---|---|
| **安全查询** | 只读校验、单条语句限制 | ✓ |
| **查询成本控制** | 为 BigQuery、Athena 等设置预算上限 | ✓ |
| **审计日志** | 完整的查询历史与追踪 | ✓ |
| **认证 / 组织 / RBAC** | 组织级访问控制 | SSO、SAML |
| **凭证保险库** | 凭证集中托管 | ✓ |
| **连接器** | 15+ 数据源 | ✓ |
| **数据洞察** | — | ✓ |
| **SLA / 合规** | — | ✓ |

---

## 快速安装

```bash
npm install -g @onequery/cli
```

其他安装方式：

```bash
brew install wordbricks/tap/onequery    # Homebrew
bun add -g @onequery/cli                # Bun
curl -fsSL https://onequery.dev/install.sh | sh    # 安装脚本
```

不想全局安装也可以直接跑：`npx @onequery/cli --help` 或 `bunx @onequery/cli --help`。

---

## 快速开始

### 方案 A：自己跑一套服务器

```bash
onequery gateway start
onequery auth login
```

接入数据源并查询：

```bash
onequery source connect --source postgres \
  --input '{"sourceKey":"warehouse","credentials":{"host":"db.example.com","database":"app","username":"onequery_readonly","password":"<read-only-password>"}}'
onequery query exec --source postgres://warehouse --sql "select 1"
```

在 CLI 中引用已连接的数据源时使用 `<provider>://<local-name>`，例如
`postgres://warehouse`。

### 方案 B：连到已有的服务器

```bash
onequery config set api.server_url https://onequery.example.com
onequery auth login
onequery source list
onequery query exec --source <provider>://<local-name> --sql "select 1"
```

---

## 支持的数据源

PostgreSQL · Supabase · MySQL · Snowflake · MongoDB · BigQuery · AWS Athena · Google Analytics · Amplitude · Mixpanel · PostHog · Sentry · GitHub · Linear · Laminar

各数据源的接入参数可以跑 `onequery source connect --help` 查看。

---

## 文档

| 文档 | 内容 |
|----------|-------------|
| [自部署指南](./docs/self-host.md) | 安装、代理、SMTP、存储、备份、恢复、升级 |
| [架构设计](./docs/architecture.md) | 系统设计、monorepo 结构、运行时 |
| [CLI 参考](./apps/cli/README.md) | CLI 工作区、配置与运行时行为 |
| [环境变量与密钥](./docs/env-secrets-management.md) | Web/Server 工作区的本地配置管理 |

---

## Claude Code 插件

从 Wordbricks 市场安装 `onequery` Claude Code 插件：

```bash
/plugin marketplace add wordbricks/skills
/plugin install onequery@wordbricks
```

如果你的 Agent 支持 skills，直接安装 `onequery-cli`：

```bash
npx skills add https://github.com/wordbricks/skills --skill onequery-cli -y
```

## OpenClaw 插件

OpenClaw 插件会打包 `onequery-openclaw` skill，让 Agent 通过 OpenClaw 内置的
`exec` 工具直接调用 `onequery` CLI。

显式从 ClawHub 安装：

```bash
openclaw plugins install clawhub:@onequery/openclaw-plugin
openclaw plugins enable onequery
```

从 npm 安装（对于这种 bare package spec，OpenClaw 也会先查 ClawHub，再回退到 npm）：

```bash
openclaw plugins install @onequery/openclaw-plugin
openclaw plugins enable onequery
```

从本仓库源码安装：

```bash
bun run --cwd packages/openclaw-plugin build
openclaw plugins install -l ./packages/openclaw-plugin
openclaw plugins enable onequery
```

如果你想先用独立的 ClawHub CLI 查看已发布包：

```bash
clawhub package inspect @onequery/openclaw-plugin
```

如果你的环境会把插件条目持久化到 `openclaw.json`，也请确认这里是启用状态：

```json5
{
  plugins: {
    entries: {
      onequery: { enabled: true },
    },
  }
}
```

启用后请开启一个新的会话，这样 OpenClaw 才会重新加载打包进来的 skill。

## Hermes

不想装插件、直接在 Hermes Agent 里用的话，装独立的 `onequery-cli` skill 就行：

```bash
hermes skills install skills-sh/wordbricks/skills/onequery-cli --yes --force
```

启动 Hermes 时把 skill 预加载进去：

```bash
hermes chat --skills onequery-cli
```

或者在现有会话里加载：

```text
Load skill onequery-cli.
```

---

## 技术栈

撑起 OneQuery 可靠性的库：

- [better-result](https://github.com/dmmulroy/better-result) by [Dillon Mulroy](https://x.com/dillon_mulroy)：每个错误都得显式处理，异常不会被悄悄吞掉。
- [antiox](https://github.com/rivet-dev/antiox) by [Rivet](https://rivet.dev/)：并发查询、超时、取消都行为可控，不会漏任务、也不会挂住连接。
- [XState](https://github.com/statelyai/xstate)：把复杂的 Dashboard 流程建模为显式状态机，让 UI 状态转换可测试、可预测。
- [proptest](https://github.com/proptest-rs/proptest)：用生成式属性测试覆盖 Rust 运行时状态机和路径不变量，减少只靠手写样例留下的盲区。
- [connect-rust](https://github.com/anthropics/connect-rust) by [Anthropic](https://www.anthropic.com/)：提供基于 Tower 的 Rust Connect RPC 支持，覆盖 Connect、gRPC 和 gRPC-Web。
- [polyglot](https://github.com/tobilg/polyglot)：解析、转译、格式化 32+ 种 SQL 方言，让跨数据库查询处理保持一致。

---

## 贡献

欢迎为项目贡献改进。PR 流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 许可证

Apache 2.0，详见 [LICENSE](./LICENSE)。
