import type { GuideContent } from "./types";

export const googleSearchConsoleGuideContent = {
  providerLabel: "Google Search Console",
  ko: {
    title: "Google Search Console OAuth 연결 가이드",
    description:
      "OneQuery의 Google Search Console 연결은 Search Console property 접근 권한이 있는 Google 계정으로 OAuth 승인을 진행합니다. CLI나 JSON 연결에서는 access token과 optional 기본 site URL을 직접 입력할 수도 있습니다.",
    steps: [
      {
        title: "Search Console property 접근 권한 확인",
        paragraphs: [
          "https://search.google.com/search-console 을 열고 OneQuery이 조회할 property가 보이는지 확인하세요.",
          "Domain property는 `sc-domain:example.com` 형식이고, URL-prefix property는 `https://www.example.com/`처럼 전체 URL 형식입니다.",
          "이 값은 OneQuery의 `credentials.siteUrl`에 넣을 수 있으며, `/searchAnalytics/query` 요청의 기본 site selector로 사용됩니다.",
        ],
        note: "스크린샷은 실제 계정, property, 성능 수치를 숨긴 상태입니다. 연결할 때는 Search Console에 표시되는 property string을 그대로 사용하세요.",
        imageSrc: "/images/google-search-console/step1_confirm_property.png",
        imageAlt:
          "Google Search Console overview with account, property, and metrics hidden",
      },
      {
        title: "Google OAuth 승인 진행",
        paragraphs: [
          "OneQuery dashboard에서는 Google Search Console 연결 화면의 `Connect with Google` 버튼을 눌러 OAuth 승인을 진행하세요.",
          "수동 토큰 발급이나 CLI 연결을 검증할 때는 OAuth 2.0 Playground 또는 자체 Google OAuth client에서 `https://www.googleapis.com/auth/webmasters.readonly` scope를 선택하세요.",
          "Playground를 사용할 때는 custom scope 입력칸에 scope URL을 붙여 넣고 `Authorize APIs`를 누릅니다.",
          "Google 계정 선택, MFA, consent 화면은 브라우저에서 직접 확인하고 승인해야 합니다.",
        ],
        note: "OAuth Playground는 빠른 수동 연결 확인용입니다. 장기 운영 연결은 조직의 Google OAuth client와 토큰 갱신 정책을 사용하는 편이 안전합니다.",
        imageSrc: "/images/google-search-console/step2_scope_selected.png",
        imageAlt:
          "OAuth 2.0 Playground with the Search Console readonly scope selected",
        reverse: true,
      },
      {
        title: "CLI 또는 JSON 연결용 access token 복사",
        paragraphs: [
          "Dashboard OAuth 연결은 승인 후 OneQuery이 토큰을 저장하므로 이 단계를 직접 수행하지 않아도 됩니다.",
          "CLI 또는 JSON 연결을 사용할 때는 승인 후 authorization code를 token으로 교환하고 `Access token` 값을 복사하세요.",
          "연결 JSON의 `credentials.accessToken`에 붙여 넣고, 기본 property를 고정하려면 `credentials.siteUrl`도 함께 넣으세요.",
          "Search Console API의 `/sites` 조회만 테스트하려면 `siteUrl`을 비워 둘 수 있지만, `/searchAnalytics/query`를 짧은 selector로 쓰려면 `siteUrl`이 필요합니다.",
        ],
        code: `{
  "name": "gsc_main",
  "credentials": {
    "type": "google_search_console",
    "accessToken": "ya29...",
    "siteUrl": "sc-domain:example.com"
  }
}`,
        note: "Access token은 민감 정보입니다. 스크린샷, 채팅, 로그에 노출되었다면 해당 토큰을 폐기하고 새로 발급하세요.",
        imageSrc: "/images/google-search-console/step3_copy_access_token.png",
        imageAlt:
          "OAuth 2.0 Playground token exchange panel with masked example token values",
      },
    ],
    closingTitle: "연결 준비 완료!",
    closingDescription:
      "이제 dashboard OAuth 승인을 완료하거나, CLI 입력 JSON에 Search Console access token과 optional site URL을 넣으면 됩니다.",
    closingNote:
      "현재 OneQuery Source API는 `siteUrl`이 설정된 경우 `/searchAnalytics/query`를 `/sites/<siteUrl>/searchAnalytics/query`로 확장합니다. 다른 property를 조회할 때는 명시적인 `/sites/...` selector를 사용하세요.",
  },
  en: {
    title: "Google Search Console OAuth Guide",
    description:
      "The OneQuery Google Search Console connection authorizes a Google account that can read the Search Console property. CLI and JSON connections can also provide an access token plus an optional default site URL directly.",
    steps: [
      {
        title: "Confirm access to the Search Console property",
        paragraphs: [
          "Open https://search.google.com/search-console and confirm that the property OneQuery should query is visible.",
          "Domain properties use the `sc-domain:example.com` format. URL-prefix properties use a full URL such as `https://www.example.com/`.",
          "You can save that value as `credentials.siteUrl`; OneQuery uses it as the default site selector for `/searchAnalytics/query`.",
        ],
        note: "The screenshot hides the real account, property, and performance metrics. When connecting, copy the exact property string shown by Search Console.",
        imageSrc: "/images/google-search-console/step1_confirm_property.png",
        imageAlt:
          "Google Search Console overview with account, property, and metrics hidden",
      },
      {
        title: "Authorize with Google OAuth",
        paragraphs: [
          "In the OneQuery dashboard, click `Connect with Google` from the Google Search Console connection form to start OAuth.",
          "For manual token generation or CLI connection checks, select the `https://www.googleapis.com/auth/webmasters.readonly` scope in OAuth 2.0 Playground or in your own Google OAuth client.",
          "For Playground, paste the scope URL into the custom scope input and click `Authorize APIs`.",
          "Handle Google account selection, MFA, and the consent screen directly in the browser.",
        ],
        note: "OAuth Playground is useful for a quick manual connection check. For a long-running production connection, prefer your organization's Google OAuth client and token refresh policy.",
        imageSrc: "/images/google-search-console/step2_scope_selected.png",
        imageAlt:
          "OAuth 2.0 Playground with the Search Console readonly scope selected",
        reverse: true,
      },
      {
        title: "Copy the access token for CLI or JSON connections",
        paragraphs: [
          "Dashboard OAuth stores the token for you after consent, so you do not need to copy it manually.",
          "For CLI or JSON connections, exchange the authorization code for tokens after consent and copy the `Access token` value.",
          "Paste it into `credentials.accessToken` in the connection JSON. Include `credentials.siteUrl` when you want OneQuery to default queries to one property.",
          "You can omit `siteUrl` for `/sites` discovery, but short `/searchAnalytics/query` selectors need a configured `siteUrl`.",
        ],
        code: `{
  "name": "gsc_main",
  "credentials": {
    "type": "google_search_console",
    "accessToken": "ya29...",
    "siteUrl": "sc-domain:example.com"
  }
}`,
        note: "Treat the access token as sensitive. If it appears in a screenshot, chat, or log, revoke it and issue a new token.",
        imageSrc: "/images/google-search-console/step3_copy_access_token.png",
        imageAlt:
          "OAuth 2.0 Playground token exchange panel with masked example token values",
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "Finish the dashboard OAuth flow, or paste the Search Console access token and optional site URL into a CLI JSON payload.",
    closingNote:
      "When `siteUrl` is configured, OneQuery Source API expands `/searchAnalytics/query` to `/sites/<siteUrl>/searchAnalytics/query`. Use explicit `/sites/...` selectors when querying a different property.",
  },
} satisfies GuideContent;
