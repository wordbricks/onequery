import type { GuideContent } from "./types";

export const posthogGuideContent = {
  providerLabel: "PostHog",
  ko: {
    title: "PostHog API 연동 가이드",
    description:
      "OneQuery과 연동하려면 PostHog의 Project ID, Personal API Key, 그리고 올바른 Host URL이 필요합니다.",
    steps: [
      {
        title: "Host URL 확인하기",
        paragraphs: [
          "PostHog Cloud를 사용 중이면 리전별 Host URL을 확인해 주세요.",
          "미국 리전은 https://us.posthog.com, 유럽 리전은 https://eu.posthog.com 입니다. Self-hosted 환경이면 해당 배포의 Base URL을 사용하세요.",
        ],
      },
      {
        title: "Project ID 찾기",
        paragraphs: [
          "PostHog에서 연결하려는 프로젝트를 연 뒤 Project settings 또는 프로젝트 상세 정보 화면으로 이동해 주세요.",
          "Project ID 값을 복사해 주세요.",
        ],
        reverse: true,
      },
      {
        title: "Personal API Key 발급",
        paragraphs: [
          "Settings에서 Personal API keys 메뉴를 열고 새 키를 생성해 주세요.",
          "분석/조회에 필요한 읽기 권한이 포함된 키를 사용하세요.",
        ],
        note: "Personal API Key는 생성 직후에만 다시 볼 수 있는 경우가 있으니 안전한 곳에 저장해 두세요.",
      },
      {
        title: "OneQuery에 입력",
        paragraphs: [
          "복사한 Project ID, Personal API Key, Host URL을 OneQuery 연결 화면에 입력해 주세요.",
        ],
        bullets: ["Project ID", "Personal API Key", "Host URL"],
        reverse: true,
      },
    ],
    closingTitle: "연동 준비 완료!",
    closingDescription:
      "이제 OneQuery에서 PostHog 데이터를 안전하게 조회할 수 있습니다.",
  },
  en: {
    title: "PostHog API Guide",
    description:
      "To connect PostHog to OneQuery, you need the Project ID, a Personal API Key, and the correct Host URL.",
    steps: [
      {
        title: "Confirm Your Host URL",
        paragraphs: [
          "Check which PostHog host your project lives on before connecting.",
          "Use https://us.posthog.com for US Cloud, https://eu.posthog.com for EU Cloud, or the base URL of your self-hosted deployment.",
        ],
      },
      {
        title: "Find the Project ID",
        paragraphs: [
          "Open the PostHog project you want to connect, then navigate to the project settings or project details page.",
          "Copy the Project ID value.",
        ],
        reverse: true,
      },
      {
        title: "Create a Personal API Key",
        paragraphs: [
          "Open Settings and go to Personal API keys.",
          "Create a key with the read/query access required for analytics requests.",
        ],
        note: "Save the key immediately if your workspace only shows it once.",
      },
      {
        title: "Enter the Values in OneQuery",
        paragraphs: ["Paste the copied values into the OneQuery setup form."],
        bullets: ["Project ID", "Personal API Key", "Host URL"],
        reverse: true,
      },
    ],
    closingTitle: "Integration Ready!",
    closingDescription: "You can now query PostHog data from OneQuery.",
  },
} satisfies GuideContent;
