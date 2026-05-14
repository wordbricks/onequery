import type { GuideContent } from "./types";

export const cloudflareWorkersObservabilityGuideContent = {
  providerLabel: "Cloudflare Workers Observability",
  ko: {
    title: "Cloudflare Workers Observability 연결 가이드",
    description:
      "OneQuery의 Cloudflare Workers Observability 연결은 `accountId`, `apiToken`, optional `scriptName`, optional `apiBaseUrl`를 받습니다. Workers Logs가 켜진 계정과 읽기용 API Token을 준비해 주세요.",
    steps: [
      {
        title: "Workers Logs 활성화",
        paragraphs: [
          "Cloudflare Worker의 Wrangler 설정에서 Workers Logs를 활성화해 주세요. 로그가 수집되어야 Workers Observability Telemetry API에서 조회할 수 있습니다.",
          "`scriptName`을 비워 두면 계정 범위에서 조회하고, 특정 Worker로 좁히려면 Worker script 이름을 OneQuery 입력값에 넣어 주세요.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step2_enable_workers_logs.png",
        imageAlt: "Cloudflare Workers Logs 활성화 문서 화면",
        code: `[observability]
enabled = true`,
      },
      {
        title: "Account ID 확인",
        paragraphs: [
          "Cloudflare Dashboard에서 대상 계정을 연 뒤 Overview 또는 URL에서 Account ID를 확인해 주세요.",
          "OneQuery는 이 값을 `/accounts/{account_id}/workers/observability/telemetry/*` API 경로에 사용합니다.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step5_workers_pages_account_id.png",
        imageAlt: "Cloudflare Account ID 위치 안내 화면",
      },
      {
        title: "API Token 생성 화면 열기",
        paragraphs: [
          "Cloudflare Dashboard의 My Profile > API Tokens에서 Create Token을 선택해 주세요.",
          "OneQuery 전용 토큰을 따로 만들면 나중에 권한 회수와 만료 관리가 쉽습니다.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step3_user_api_tokens.png",
        imageAlt: "Cloudflare User API Tokens 화면",
      },
      {
        title: "Custom Token 선택",
        paragraphs: [
          "Create API Token 화면에서 Create Custom Token의 Get started를 선택해 주세요.",
          "템플릿 대신 Custom token을 사용하면 Workers Observability 권한과 대상 계정 범위를 명확히 제한할 수 있습니다.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step4_create_api_token.png",
        imageAlt: "Cloudflare Create API Token 화면",
      },
      {
        title: "Workers Observability 읽기 권한 설정",
        paragraphs: [
          "Token name을 입력한 뒤 Permissions에서 Account > Workers Observability를 선택하고 권한 레벨은 Read로 설정해 주세요.",
          "Account Resources는 Include로 두고 대상 Cloudflare 계정만 선택하는 것을 권장합니다.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step6_workers_observability_permission.png",
        imageAlt: "Cloudflare Workers Observability 권한 선택 화면",
        note: "API Token 값은 비밀값입니다. 스크린샷, 이슈, 채팅에 노출하지 마세요.",
      },
      {
        title: "OneQuery에 입력",
        paragraphs: [
          "OneQuery 웹 폼 또는 CLI JSON에 Account ID와 API Token을 입력해 주세요.",
          "Cloudflare 기본 API를 사용할 때 `apiBaseUrl`은 비워 두면 됩니다. 프록시나 테스트용 엔드포인트가 있을 때만 설정해 주세요.",
        ],
        bullets: [
          "`accountId`: Cloudflare Account ID",
          "`apiToken`: 읽기용 Cloudflare API Token",
          "`scriptName` (optional): Worker script 이름",
          "`apiBaseUrl` (optional): 기본값은 `https://api.cloudflare.com/client/v4`",
        ],
        code: `{
  "name": "cloudflare_workers",
  "credentials": {
    "type": "cloudflare_workers_observability",
    "accountId": "023e105f4ecef8ad9ca31a8372d0c353",
    "apiToken": "cf_api_token",
    "scriptName": "api-production"
  }
}`,
      },
    ],
    closingTitle: "연결 준비 완료",
    closingDescription:
      "연결 후 Source API에서 `list_keys`, `list_values`, `run_query` 작업으로 Workers Observability telemetry를 조회할 수 있습니다.",
  },
  en: {
    title: "Cloudflare Workers Observability Connection Guide",
    description:
      "The OneQuery Cloudflare Workers Observability connection accepts `accountId`, `apiToken`, optional `scriptName`, and optional `apiBaseUrl`. Prepare an account with Workers Logs enabled and a read-only API token.",
    steps: [
      {
        title: "Enable Workers Logs",
        paragraphs: [
          "Enable Workers Logs in the Worker Wrangler configuration. Telemetry must be collected before the Workers Observability Telemetry API can return data.",
          "Leave `scriptName` empty for account-level queries, or set it to a Worker script name when you want examples and queries scoped to one Worker.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step2_enable_workers_logs.png",
        imageAlt: "Cloudflare Workers Logs enablement documentation screen",
        code: `[observability]
enabled = true`,
      },
      {
        title: "Find the Account ID",
        paragraphs: [
          "Open the target account in the Cloudflare Dashboard and copy the Account ID from the account overview or URL.",
          "OneQuery uses this value in the `/accounts/{account_id}/workers/observability/telemetry/*` API path.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step5_workers_pages_account_id.png",
        imageAlt: "Cloudflare Account ID location guide",
      },
      {
        title: "Open API token creation",
        paragraphs: [
          "Open My Profile > API Tokens in the Cloudflare Dashboard, then choose Create Token.",
          "Create a dedicated token for OneQuery so it can be revoked or expired independently later.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step3_user_api_tokens.png",
        imageAlt: "Cloudflare User API Tokens page",
      },
      {
        title: "Choose Custom Token",
        paragraphs: [
          "On Create API Token, choose Get started in the Create Custom Token row.",
          "A custom token lets you limit the permission and account scope to Workers Observability only.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step4_create_api_token.png",
        imageAlt: "Cloudflare Create API Token page",
      },
      {
        title: "Set Workers Observability read access",
        paragraphs: [
          "Enter a token name, then set Permissions to Account > Workers Observability and choose the Read permission level.",
          "For Account Resources, use Include and restrict the token to the target Cloudflare account when possible.",
        ],
        imageSrc:
          "/images/cloudflare-workers-observability/step6_workers_observability_permission.png",
        imageAlt: "Cloudflare Workers Observability permission selection",
        note: "The API token is secret. Do not include it in screenshots, issues, or chat.",
      },
      {
        title: "Enter the fields in OneQuery",
        paragraphs: [
          "Paste the Account ID and API token into the OneQuery form or CLI JSON payload.",
          "Leave `apiBaseUrl` empty for the default Cloudflare API. Set it only for a proxy or test endpoint.",
        ],
        bullets: [
          "`accountId`: Cloudflare Account ID",
          "`apiToken`: read-only Cloudflare API token",
          "`scriptName` (optional): Worker script name",
          "`apiBaseUrl` (optional): defaults to `https://api.cloudflare.com/client/v4`",
        ],
        code: `{
  "name": "cloudflare_workers",
  "credentials": {
    "type": "cloudflare_workers_observability",
    "accountId": "023e105f4ecef8ad9ca31a8372d0c353",
    "apiToken": "cf_api_token",
    "scriptName": "api-production"
  }
}`,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "After connecting, use Source API operations `list_keys`, `list_values`, and `run_query` to query Workers Observability telemetry.",
  },
} satisfies GuideContent;
