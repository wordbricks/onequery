# OneQuery

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <a href="https://onequery.dev"><img src="https://img.shields.io/badge/Site-onequery.dev-blue?style=for-the-badge" alt="Site"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-green?style=for-the-badge" alt="License: Apache 2.0"></a>
</p>

**自托管 OneQuery，连接数据库、分析工具和 API，集中管理凭证，通过 CLI 和 Web UI 运行安全、可审计的查询。**

一个界面管理整个数据栈，内置安全防护，为团队提供更简洁的工作流。

---

## 功能

| | 自托管 | 云端 / 企业版 |
|---|---|---|
| **安全查询** | 只读验证、单语句执行 | ✓ |
| **查询成本限制** | BigQuery、Athena 等预算上限 | ✓ |
| **审计日志** | 完整的查询历史与追踪 | ✓ |
| **认证 / 组织 / RBAC** | 组织级访问控制 | SSO、SAML |
| **凭证保险库** | 集中化凭证管理 | ✓ |
| **连接器** | 15+ 数据源 | ✓ |
| **自然语言转 SQL** | — | ✓ |
| **数据洞察** | — | ✓ |
| **SLA / 合规** | — | ✓ |

---

## 快速安装

```bash
curl -fsSL https://onequery.dev/install.sh | sh
```

或使用包管理器：

```bash
brew install wordbricks/tap/onequery    # Homebrew
npm install -g @onequery/cli            # npm
bun add -g @onequery/cli                # Bun
```

无需全局安装：`npx @onequery/cli --help` 或 `bunx @onequery/cli --help`。

---

## 快速开始

### 方式 A：自托管（运行自己的服务器）

```bash
onequery gateway start
onequery auth login
```

添加数据源并执行查询：

```bash
onequery source connect --source postgres \
  --input '{"name":"warehouse","credentials":{"host":"db.example.com","database":"app","username":"onequery","password":"secret"}}'
onequery query execute --source warehouse --sql "select 1"
```

### 方式 B：连接到现有服务器

```bash
onequery config set server https://onequery.example.com
onequery auth login
onequery source list
onequery query execute --source <source-key> --sql "select 1"
```

---

## 支持的数据源

PostgreSQL · Supabase · MySQL · MongoDB · BigQuery · AWS Athena · Google Analytics · Amplitude · Mixpanel · PostHog · Sentry · GitHub · Linear · Laminar

运行 `onequery source connect --help` 查看各数据源的配置说明。

---

## 文档

| 文档 | 描述 |
|----------|-------------|
| [自托管指南](./docs/self-host.md) | 安装、代理、SMTP、存储、备份、恢复、升级 |
| [架构设计](./docs/architecture.md) | 系统设计、monorepo 结构、运行时接口 |
| [CLI 参考](./apps/cli/README.md) | CLI 工作区、配置和运行时行为 |
| [环境变量与密钥](./docs/env-secrets-management.md) | Web/Server 工作区的本地配置管理流程 |

---

## Claude Code 插件

`onequery` Claude Code 插件从 Wordbricks 市场安装：

```bash
/plugin marketplace add wordbricks/skills
/plugin install onequery@wordbricks
```

对于兼容 skills 的代理，安装 `onequery-cli` skill：

```bash
npx skills add https://github.com/wordbricks/skills --skill onequery-cli -y
```

## OpenClaw 插件

通过 npm 安装：

```bash
openclaw plugins install @onequery/openclaw-plugin
openclaw plugins enable onequery
```

从本仓库本地安装：

```bash
openclaw plugins install -l ./packages/openclaw-plugin
openclaw plugins enable onequery
```

然后在 `openclaw.json` 中启用插件：

```json5
{
  plugins: {
    entries: {
      onequery: { enabled: true },
    },
  }
}
```

---

## 贡献

我们欢迎数据源集成方面的贡献。请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解项目结构和 PR 流程。

---

## 许可证

Apache 2.0。详见 [LICENSE](./LICENSE)。
