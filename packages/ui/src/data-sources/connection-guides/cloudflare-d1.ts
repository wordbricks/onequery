import type { GuideContent } from "./types";

export const cloudflareD1GuideContent = {
  providerLabel: "Cloudflare D1",
  ko: {
    title: "Cloudflare D1 연결 가이드",
    description:
      "OneQuery의 Cloudflare D1 연결은 `accountId`, `databaseId`, `apiToken`, optional `apiBaseUrl`를 받습니다. 대상 D1 database를 조회할 수 있는 Cloudflare API Token을 준비해 주세요.",
    steps: [
      {
        title: "Account ID 확인",
        paragraphs: [
          "Cloudflare Dashboard에서 대상 계정을 열고 Account ID를 복사해 주세요.",
          "OneQuery는 이 값을 Cloudflare D1 REST API의 `/accounts/{account_id}` 경로에 사용합니다.",
        ],
      },
      {
        title: "Database ID 확인",
        paragraphs: [
          "Cloudflare Dashboard에서 D1 메뉴를 열고 연결할 database를 선택해 주세요.",
          "database 설정 화면에서 Database ID를 복사해 `databaseId`로 입력합니다.",
        ],
      },
      {
        title: "API Token 준비",
        paragraphs: [
          "Cloudflare API Tokens 화면에서 OneQuery 전용 token을 생성해 주세요.",
          "가능하면 대상 account와 D1 database 조회에 필요한 최소 권한으로 제한해 주세요.",
        ],
        note: "API Token 값은 비밀값입니다. 스크린샷, 이슈, 채팅에 노출하지 마세요.",
      },
      {
        title: "OneQuery에 입력",
        paragraphs: [
          "OneQuery 웹 폼 또는 CLI JSON에 Account ID, Database ID, API Token을 입력해 주세요.",
          "Cloudflare 기본 API를 사용할 때 `apiBaseUrl`은 비워 두면 됩니다. 프록시나 테스트용 엔드포인트가 있을 때만 설정해 주세요.",
        ],
        bullets: [
          "`accountId`: Cloudflare Account ID",
          "`databaseId`: D1 Database ID",
          "`apiToken`: D1 조회용 Cloudflare API Token",
          "`apiBaseUrl` (optional): 기본값은 `https://api.cloudflare.com/client/v4`",
        ],
        code: `{
  "name": "cloudflare_d1_prod",
  "credentials": {
    "type": "cloudflare_d1",
    "accountId": "023e105f4ecef8ad9ca31a8372d0c353",
    "databaseId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "apiToken": "cf_api_token"
  }
}`,
      },
    ],
    closingTitle: "연결 준비 완료",
    closingDescription:
      "연결 후 SQL query 도구에서 Cloudflare D1을 SQLite dialect의 read-only query source로 사용할 수 있습니다.",
  },
  en: {
    title: "Cloudflare D1 Connection Guide",
    description:
      "The OneQuery Cloudflare D1 connection accepts `accountId`, `databaseId`, `apiToken`, and optional `apiBaseUrl`. Prepare a Cloudflare API token that can query the target D1 database.",
    steps: [
      {
        title: "Find the Account ID",
        paragraphs: [
          "Open the target account in the Cloudflare Dashboard and copy the Account ID.",
          "OneQuery uses this value in the Cloudflare D1 REST API `/accounts/{account_id}` path.",
        ],
      },
      {
        title: "Find the Database ID",
        paragraphs: [
          "Open D1 in the Cloudflare Dashboard and choose the database you want to connect.",
          "Copy the Database ID from the database settings and enter it as `databaseId`.",
        ],
      },
      {
        title: "Prepare an API token",
        paragraphs: [
          "Create a dedicated token for OneQuery from the Cloudflare API Tokens page.",
          "Limit the token to the target account and the minimum permissions required to query the D1 database when possible.",
        ],
        note: "The API token is secret. Do not include it in screenshots, issues, or chat.",
      },
      {
        title: "Enter the fields in OneQuery",
        paragraphs: [
          "Paste the Account ID, Database ID, and API token into the OneQuery form or CLI JSON payload.",
          "Leave `apiBaseUrl` empty for the default Cloudflare API. Set it only for a proxy or test endpoint.",
        ],
        bullets: [
          "`accountId`: Cloudflare Account ID",
          "`databaseId`: D1 Database ID",
          "`apiToken`: Cloudflare API token for D1 queries",
          "`apiBaseUrl` (optional): defaults to `https://api.cloudflare.com/client/v4`",
        ],
        code: `{
  "name": "cloudflare_d1_prod",
  "credentials": {
    "type": "cloudflare_d1",
    "accountId": "023e105f4ecef8ad9ca31a8372d0c353",
    "databaseId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "apiToken": "cf_api_token"
  }
}`,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "After connecting, SQL query tools can use Cloudflare D1 as a read-only SQLite-dialect query source.",
  },
} satisfies GuideContent;
