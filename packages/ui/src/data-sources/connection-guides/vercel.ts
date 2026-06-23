import type { GuideContent } from "./types";

export const vercelGuideContent = {
  providerLabel: "Vercel",
  ko: {
    title: "Vercel Access Token 연결 가이드",
    description:
      "OneQuery의 Vercel 연결은 `apiToken`과 optional `apiBaseUrl`를 받습니다. Vercel Account Settings에서 API Access Token을 생성한 뒤 OneQuery에 붙여 넣어 주세요.",
    steps: [
      {
        title: "Vercel Tokens 페이지 열기",
        paragraphs: [
          "Vercel에 로그인한 뒤 Personal Account의 Settings > Tokens로 이동해 주세요.",
          "직접 열려면 https://vercel.com/account/settings/tokens 를 사용해도 됩니다.",
        ],
        note: "Vercel 문서 기준으로 Access Token은 Vercel API 인증에 필요하며 Account Settings의 Tokens 페이지에서 생성하고 관리합니다.",
        imageSrc: "/images/vercel/step1_tokens_page.png",
        imageAlt: "Vercel Tokens page showing the Create Token form",
      },
      {
        title: "토큰 이름, 범위, 만료 기간 설정",
        paragraphs: [
          "`Token name`에는 `OneQuery Read Access`처럼 나중에 알아보기 쉬운 이름을 입력해 주세요.",
          "`Scope`에서는 OneQuery이 조회해야 하는 Personal Account 또는 Team을 선택해 주세요. Team API를 조회하려면 해당 Team 범위가 포함된 토큰이 필요합니다.",
          "`Expiration`은 가능한 유한 기간을 선택해 주세요. 예시는 `1 Year`이지만 조직 정책에 맞게 더 짧게 설정해도 됩니다.",
        ],
        note: "Scope 드롭다운에는 개인 계정, 팀, 프로젝트 이름이 표시될 수 있으므로 공유용 스크린샷에는 포함하지 않았습니다.",
        imageSrc: "/images/vercel/step2_configure_token.png",
        imageAlt:
          "Vercel Create Token form with a descriptive token name and one-year expiration",
        reverse: true,
      },
      {
        title: "Create 후 토큰 값을 즉시 복사",
        paragraphs: [
          "`Create`를 누른 뒤 표시되는 토큰 값을 즉시 복사해 주세요. Vercel은 생성된 토큰 값을 다시 보여주지 않습니다.",
          "토큰 값은 OneQuery의 Vercel 연결 화면에서 `credentials.apiToken`에 붙여 넣습니다.",
        ],
        code: `{
  "name": "vercel_main",
  "credentials": {
    "type": "vercel",
    "apiToken": "vercel_api_token"
  }
}`,
        note: "토큰은 민감 정보입니다. 스크린샷, 채팅, 로그에 노출되었다면 Vercel Tokens 페이지에서 즉시 revoke하고 새 토큰을 생성하세요.",
      },
      {
        title: "Team 범위 API 호출 준비",
        paragraphs: [
          "Vercel Team 데이터를 조회할 때는 Source API 요청의 `params.teamId`에 Team ID를 넘겨 주세요.",
          "Team ID는 Vercel Team settings에서 확인할 수 있으며, 토큰 Scope도 같은 Team에 접근할 수 있어야 합니다.",
          "일반 Vercel Cloud API를 사용할 때는 `apiBaseUrl`을 비워 두세요. Vercel 호환 프록시나 별도 API origin을 써야 할 때만 설정합니다.",
        ],
        bullets: [
          "`apiToken`: 생성한 Vercel Access Token",
          "`apiBaseUrl` (optional): 기본값은 `https://api.vercel.com`",
          "`params.teamId`: Team-scoped Source API 요청에 필요한 Team ID",
        ],
      },
    ],
    closingTitle: "연결 준비 완료!",
    closingDescription:
      "이제 생성한 Access Token을 OneQuery Vercel 연결 화면이나 CLI 입력 JSON에 넣으면 됩니다.",
    closingNote:
      "Vercel API는 bearer token 인증을 사용합니다. OneQuery은 저장된 `apiToken`을 서버 측에서 Authorization header로 전달합니다.",
  },
  en: {
    title: "Vercel Access Token Connection Guide",
    description:
      "The OneQuery Vercel connection accepts `apiToken` and optional `apiBaseUrl`. Create a Vercel API Access Token from Account Settings, then paste it into OneQuery.",
    steps: [
      {
        title: "Open the Vercel Tokens page",
        paragraphs: [
          "Sign in to Vercel, then open Settings > Tokens from your Personal Account.",
          "You can also open https://vercel.com/account/settings/tokens directly.",
        ],
        note: "Vercel documents Access Tokens as the credentials required for Vercel API authentication. They are created and managed from the Account Settings Tokens page.",
        imageSrc: "/images/vercel/step1_tokens_page.png",
        imageAlt: "Vercel Tokens page showing the Create Token form",
      },
      {
        title: "Set the token name, scope, and expiration",
        paragraphs: [
          "Use a recognizable `Token name`, such as `OneQuery Read Access`.",
          "For `Scope`, choose the Personal Account or Team that OneQuery should inspect. Team API calls require a token scoped to that Team.",
          "For `Expiration`, prefer a finite duration. The screenshot uses `1 Year`, but a shorter value is fine if your policy requires it.",
        ],
        note: "The Scope dropdown can expose account, team, and project names, so it is intentionally not shown in the shared screenshot.",
        imageSrc: "/images/vercel/step2_configure_token.png",
        imageAlt:
          "Vercel Create Token form with a descriptive token name and one-year expiration",
        reverse: true,
      },
      {
        title: "Create the token and copy it immediately",
        paragraphs: [
          "Click `Create`, then copy the token value immediately. Vercel does not show the generated token value again.",
          "Paste the value into `credentials.apiToken` in the OneQuery Vercel connection form.",
        ],
        code: `{
  "name": "vercel_main",
  "credentials": {
    "type": "vercel",
    "apiToken": "vercel_api_token"
  }
}`,
        note: "Treat the token as sensitive. If it appears in a screenshot, chat, or log, revoke it from the Vercel Tokens page and create a new one.",
      },
      {
        title: "Prepare for Team-scoped API calls",
        paragraphs: [
          "When querying Vercel Team data, pass the Team ID as `params.teamId` in Source API requests.",
          "You can find the Team ID in Vercel Team settings. The token Scope must also include that Team.",
          "Leave `apiBaseUrl` empty for the normal Vercel Cloud API. Only set it for a Vercel-compatible proxy or alternate API origin.",
        ],
        bullets: [
          "`apiToken`: the Vercel Access Token you created",
          "`apiBaseUrl` (optional): defaults to `https://api.vercel.com`",
          "`params.teamId`: Team ID for Team-scoped Source API requests",
        ],
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "Paste the Access Token into the OneQuery Vercel connection form or CLI JSON payload to finish the setup.",
    closingNote:
      "The Vercel API uses bearer token authentication. OneQuery sends the saved `apiToken` server-side in the Authorization header.",
  },
} satisfies GuideContent;
