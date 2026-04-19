# OneQuery

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <a href="https://onequery.dev"><img src="https://img.shields.io/badge/Site-onequery.dev-blue?style=for-the-badge" alt="Site"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-green?style=for-the-badge" alt="License: Apache 2.0"></a>
</p>

**自託管 OneQuery，連接資料庫、分析工具和 API，集中管理憑證，透過 CLI 和 Web UI 執行安全、可稽核的查詢。**

一個介面管理整個資料堆疊，內建安全防護，為團隊提供更簡潔的工作流程。

---

## 功能

| | 自託管 | 雲端 / 企業版 |
|---|---|---|
| **安全查詢** | 唯讀驗證、單語句執行 | ✓ |
| **查詢成本限制** | BigQuery、Athena 等預算上限 | ✓ |
| **稽核日誌** | 完整的查詢歷史與追蹤 | ✓ |
| **認證 / 組織 / RBAC** | 組織層級存取控制 | SSO、SAML |
| **憑證保管庫** | 集中化憑證管理 | ✓ |
| **連接器** | 15+ 資料來源 | ✓ |
| **自然語言轉 SQL** | — | ✓ |
| **資料洞察** | — | ✓ |
| **SLA / 合規** | — | ✓ |

---

## 快速安裝

```bash
curl -fsSL https://onequery.dev/install.sh | sh
```

或使用套件管理器：

```bash
brew install wordbricks/tap/onequery    # Homebrew
npm install -g @onequery/cli            # npm
bun add -g @onequery/cli                # Bun
```

無需全域安裝：`npx @onequery/cli --help` 或 `bunx @onequery/cli --help`。

---

## 快速開始

### 方式 A：自託管（執行自己的伺服器）

```bash
onequery gateway start
onequery auth login
```

新增資料來源並執行查詢：

```bash
onequery source connect --source postgres \
  --input '{"name":"warehouse","credentials":{"host":"db.example.com","database":"app","username":"onequery","password":"secret"}}'
onequery query execute --source warehouse --sql "select 1"
```

### 方式 B：連接到現有伺服器

```bash
onequery config set server https://onequery.example.com
onequery auth login
onequery source list
onequery query execute --source <source-key> --sql "select 1"
```

---

## 支援的資料來源

PostgreSQL · Supabase · MySQL · MongoDB · BigQuery · AWS Athena · Google Analytics · Amplitude · Mixpanel · PostHog · Sentry · GitHub · Linear · Laminar

執行 `onequery source connect --help` 查看各資料來源的設定說明。

---

## 文件

| 文件 | 描述 |
|----------|-------------|
| [自託管指南](./docs/self-host.md) | 安裝、代理、SMTP、儲存、備份、還原、升級 |
| [架構設計](./docs/architecture.md) | 系統設計、monorepo 結構、執行時期介面 |
| [CLI 參考](./apps/cli/README.md) | CLI 工作區、設定和執行時期行為 |
| [環境變數與密鑰](./docs/env-secrets-management.md) | Web/Server 工作區的本機設定管理流程 |

---

## Claude Code 外掛

`onequery` Claude Code 外掛從 Wordbricks 市集安裝：

```bash
/plugin marketplace add wordbricks/skills
/plugin install onequery@wordbricks
```

對於相容 skills 的代理程式，安裝 `onequery-cli` skill：

```bash
npx skills add https://github.com/wordbricks/skills --skill onequery-cli -y
```

## OpenClaw 外掛

透過 npm 安裝：

```bash
openclaw plugins install @onequery/openclaw-plugin
openclaw plugins enable onequery
```

從本儲存庫本機安裝：

```bash
openclaw plugins install -l ./packages/openclaw-plugin
openclaw plugins enable onequery
```

然後在 `openclaw.json` 中啟用外掛：

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

## 貢獻

我們歡迎資料來源整合方面的貢獻。請參閱 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解專案結構和 PR 流程。

---

## 授權條款

Apache 2.0。詳見 [LICENSE](./LICENSE)。
