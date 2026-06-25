import type { GuideContent } from "./types";

export const cloudflareR2SqlGuideContent = {
  providerLabel: "Cloudflare R2 SQL",
  ko: {
    title: "Cloudflare R2 SQL 연결 가이드",
    description:
      "OneQuery의 Cloudflare R2 SQL 연결은 `accountId`, `bucketName`, `apiToken`, optional `apiBaseUrl`를 받습니다. R2 Data Catalog가 활성화된 bucket과 R2 SQL 조회 권한이 있는 API Token을 준비해 주세요.",
    steps: [
      {
        title: "R2 Data Catalog 확인",
        paragraphs: [
          "Cloudflare Dashboard에서 대상 R2 bucket을 열고 R2 Data Catalog가 활성화되어 있는지 확인해 주세요.",
          "OneQuery는 R2 SQL REST API를 통해 이 catalog의 Apache Iceberg table을 조회합니다.",
        ],
      },
      {
        title: "Account ID와 Bucket 이름 확인",
        paragraphs: [
          "Cloudflare Dashboard에서 대상 계정의 Account ID를 복사해 주세요.",
          "R2 bucket 이름을 `bucketName`으로 입력합니다. Wrangler의 warehouse 이름은 보통 `{accountId}_{bucketName}` 형식이지만, OneQuery에는 두 값을 분리해서 입력합니다.",
        ],
      },
      {
        title: "API Token 준비",
        paragraphs: [
          "Cloudflare API Tokens 화면에서 OneQuery 전용 token을 생성해 주세요.",
          "R2 SQL read, R2 Data Catalog read, R2 storage access 권한을 대상 bucket 범위로 제한하는 것을 권장합니다.",
        ],
        note: "API Token 값은 비밀값입니다. 스크린샷, 이슈, 채팅에 노출하지 마세요.",
      },
      {
        title: "OneQuery에 입력",
        paragraphs: [
          "OneQuery 웹 폼 또는 CLI JSON에 Account ID, Bucket name, API Token을 입력해 주세요.",
          "Cloudflare 기본 R2 SQL API를 사용할 때 `apiBaseUrl`은 비워 두면 됩니다. 프록시나 테스트용 엔드포인트가 있을 때만 설정해 주세요.",
        ],
        bullets: [
          "`accountId`: Cloudflare Account ID",
          "`bucketName`: R2 Data Catalog가 연결된 R2 bucket 이름",
          "`apiToken`: R2 SQL 조회용 Cloudflare API Token",
          "`apiBaseUrl` (optional): 기본값은 `https://api.sql.cloudflarestorage.com/api/v1`",
        ],
        code: `{
  "name": "cloudflare_r2_sql_prod",
  "credentials": {
    "type": "cloudflare_r2_sql",
    "accountId": "023e105f4ecef8ad9ca31a8372d0c353",
    "bucketName": "analytics-events",
    "apiToken": "cf_r2_sql_token"
  }
}`,
      },
    ],
    closingTitle: "연결 준비 완료",
    closingDescription:
      "연결 후 SQL query 도구에서 `namespace.table_name` 형식으로 R2 Data Catalog의 Iceberg table을 read-only 조회할 수 있습니다.",
  },
  en: {
    title: "Cloudflare R2 SQL Connection Guide",
    description:
      "The OneQuery Cloudflare R2 SQL connection accepts `accountId`, `bucketName`, `apiToken`, and optional `apiBaseUrl`. Prepare an R2 bucket with R2 Data Catalog enabled and an API token that can run R2 SQL queries.",
    steps: [
      {
        title: "Check R2 Data Catalog",
        paragraphs: [
          "Open the target R2 bucket in the Cloudflare Dashboard and confirm that R2 Data Catalog is enabled.",
          "OneQuery queries Apache Iceberg tables in that catalog through the R2 SQL REST API.",
        ],
      },
      {
        title: "Find the Account ID and bucket name",
        paragraphs: [
          "Copy the Account ID from the target Cloudflare account.",
          "Enter the R2 bucket name as `bucketName`. Wrangler's warehouse name is usually `{accountId}_{bucketName}`, but OneQuery stores the two fields separately.",
        ],
      },
      {
        title: "Prepare an API token",
        paragraphs: [
          "Create a dedicated token for OneQuery from the Cloudflare API Tokens page.",
          "Prefer a token scoped to the target bucket with R2 SQL read, R2 Data Catalog read, and R2 storage access.",
        ],
        note: "The API token is secret. Do not include it in screenshots, issues, or chat.",
      },
      {
        title: "Enter the fields in OneQuery",
        paragraphs: [
          "Paste the Account ID, bucket name, and API token into the OneQuery form or CLI JSON payload.",
          "Leave `apiBaseUrl` empty for Cloudflare's default R2 SQL API. Set it only for a proxy or test endpoint.",
        ],
        bullets: [
          "`accountId`: Cloudflare Account ID",
          "`bucketName`: R2 bucket name with R2 Data Catalog enabled",
          "`apiToken`: Cloudflare API token for R2 SQL queries",
          "`apiBaseUrl` (optional): defaults to `https://api.sql.cloudflarestorage.com/api/v1`",
        ],
        code: `{
  "name": "cloudflare_r2_sql_prod",
  "credentials": {
    "type": "cloudflare_r2_sql",
    "accountId": "023e105f4ecef8ad9ca31a8372d0c353",
    "bucketName": "analytics-events",
    "apiToken": "cf_r2_sql_token"
  }
}`,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "After connecting, SQL query tools can read R2 Data Catalog Iceberg tables with `namespace.table_name` references.",
  },
} satisfies GuideContent;
