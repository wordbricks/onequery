import type { GuideContent } from "./types";

// NOTE: Amplitude's current UI splits this flow across `Projects` and
// org-level `API Keys`, so the old single-page key guide was stale.
export const amplitudeGuideContent = {
  providerLabel: "Amplitude",
  ko: {
    title: "Amplitude API Key 연결 가이드",
    description:
      "OneQuery에 Amplitude를 연결하려면 프로젝트의 `API Key`, `Secret Key`, 그리고 올바른 `region` 값이 필요합니다.",
    steps: [
      {
        title: "Settings 열기",
        paragraphs: [
          "Amplitude에 로그인해 주세요. 일반 워크스페이스는 https://app.amplitude.com/, EU 워크스페이스는 Amplitude EU URL에서 열립니다.",
          "우측 상단의 Settings를 열고, 좌측 사이드바에서 `Projects`와 `API Keys` 메뉴를 확인하세요.",
        ],
        imageSrc: "/images/amplitude/step1_settings_sidebar.png",
        imageAlt: "Amplitude settings sidebar",
      },
      {
        title: "대상 프로젝트 선택",
        paragraphs: [
          "`Projects`를 클릭한 뒤 OneQuery이 읽을 프로젝트를 선택하세요.",
          "프로젝트를 클릭하면 `General` 탭의 Project Details 카드로 이동합니다.",
        ],
        imageSrc: "/images/amplitude/step2_projects.png",
        imageAlt: "Amplitude projects list",
        reverse: true,
      },
      {
        title: "Secret Key 확인",
        paragraphs: [
          "프로젝트 `General` 화면의 `Project Details` 카드에서 `Secret Key` 옆 `Show`를 눌러 값을 확인하세요.",
          "`API Key` 옆 `Manage`를 누르면 API Key 목록 페이지로 이동합니다.",
        ],
        note: "이 화면은 프로젝트별 Secret Key를 보여 줍니다. OneQuery에서는 이 값을 `credentials.secretKey`에 넣습니다.",
        imageSrc: "/images/amplitude/step3_project_keys.png",
        imageAlt:
          "Amplitude project details card with secret key and API key actions",
      },
      {
        title: "API Key 복사 후 OneQuery에 연결",
        paragraphs: [
          "`API and Secret Keys` 페이지에서 대상 프로젝트의 활성 API Key를 복사하세요. 필요한 키가 없으면 `Generate API Key`를 사용하세요.",
          "복사한 값을 `credentials.apiKey`에 넣고, `region`은 EU Amplitude 프로젝트일 때만 `eu`, 그 외에는 `us`로 설정하세요.",
        ],
        code: `{
  "name": "amplitude_product",
  "credentials": {
    "type": "amplitude",
    "apiKey": "amplitude_api_key",
    "secretKey": "amplitude_secret_key",
    "region": "us"
  }
}`,
        note: "`onequery source connect --source amplitude --input '<json>'`로 연결할 수 있습니다.",
        imageSrc: "/images/amplitude/step4_api_keys.png",
        imageAlt: "Amplitude API and Secret Keys page",
        reverse: true,
      },
    ],
    closingTitle: "연동 준비 완료!",
    closingDescription:
      "이제 Amplitude의 API Key, Secret Key, region 값을 OneQuery에 넣어 연결을 마칠 수 있습니다.",
    closingNote:
      "Amplitude 화면에서 Secret Key를 노출했다면 채팅이나 스크린샷에 남기지 말고, 노출되었을 경우 새 값으로 교체하세요.",
  },
  en: {
    title: "Amplitude API Key Guide",
    description:
      "To connect Amplitude to OneQuery, collect the project's `API Key`, `Secret Key`, and the correct `region` value.",
    steps: [
      {
        title: "Open Settings",
        paragraphs: [
          "Sign in to Amplitude. Standard workspaces open at https://app.amplitude.com/, while EU workspaces use the Amplitude EU app URL.",
          "Open Settings from the top-right corner, then use the left sidebar to reach `Projects` and `API Keys`.",
        ],
        imageSrc: "/images/amplitude/step1_settings_sidebar.png",
        imageAlt: "Amplitude settings sidebar",
      },
      {
        title: "Select the target project",
        paragraphs: [
          "Open `Projects`, then click the project that OneQuery should read.",
          "That takes you to the project's `General` settings page.",
        ],
        imageSrc: "/images/amplitude/step2_projects.png",
        imageAlt: "Amplitude projects list",
        reverse: true,
      },
      {
        title: "Reveal the secret key",
        paragraphs: [
          "In the `Project Details` card on the `General` tab, click `Show` next to `Secret Key` to reveal the value you need for OneQuery.",
          "Use `Manage` next to `API Key` to open the API key inventory page.",
        ],
        note: "Use the revealed value as `credentials.secretKey` in OneQuery.",
        imageSrc: "/images/amplitude/step3_project_keys.png",
        imageAlt:
          "Amplitude project details card with secret key and API key actions",
      },
      {
        title: "Copy the API key and connect OneQuery",
        paragraphs: [
          "On `API and Secret Keys`, copy an active API key for the target project, or click `Generate API Key` if you need a new one.",
          "Use that value as `credentials.apiKey`, and set `region` to `eu` only for Amplitude EU projects; otherwise use `us`.",
        ],
        code: `{
  "name": "amplitude_product",
  "credentials": {
    "type": "amplitude",
    "apiKey": "amplitude_api_key",
    "secretKey": "amplitude_secret_key",
    "region": "us"
  }
}`,
        note: "Connect with `onequery source connect --source amplitude --input '<json>'`.",
        imageSrc: "/images/amplitude/step4_api_keys.png",
        imageAlt: "Amplitude API and Secret Keys page",
        reverse: true,
      },
    ],
    closingTitle: "Integration Ready!",
    closingDescription:
      "You now have the exact Amplitude fields OneQuery expects: API key, secret key, and region.",
    closingNote:
      "If a secret key is ever exposed in chat or screenshots, rotate it before using it again.",
  },
} satisfies GuideContent;
