import type { GuideContent } from "./types";

export const posthogGuideContent = {
  providerLabel: "PostHog",
  ko: {
    title: "PostHog API 연동 가이드",
    description:
      "OneQuery와 연동하려면 PostHog에서 Project ID, Personal API Key, 그리고 올바른 Host URL을 확인해야 합니다.",
    steps: [
      {
        title: "프로젝트 설정 열기",
        paragraphs: [
          "연결할 PostHog 프로젝트를 연 뒤 `Settings -> Project -> General`로 이동해 주세요.",
          "`Project token & ID` 섹션에서 OneQuery에 필요한 프로젝트 정보를 확인할 수 있습니다.",
        ],
        imageSrc: "/images/posthog/step1_project_settings.png",
        imageAlt: "PostHog Project Settings General Page",
      },
      {
        title: "Project ID와 Host URL 확인",
        paragraphs: [
          "`Project token & ID` 섹션에서 `Project ID`를 복사해 주세요.",
          "Host URL은 현재 PostHog 앱 주소의 origin을 사용하면 됩니다. US Cloud는 `https://us.posthog.com`, EU Cloud는 `https://eu.posthog.com`, Self-hosted는 배포 Base URL을 입력해 주세요.",
        ],
        note: "웹 SDK 예시에 보이는 `api_host` (`https://us.i.posthog.com` 등)는 수집용 호스트입니다. OneQuery에는 `https://us.posthog.com` 또는 `https://eu.posthog.com` 같은 PostHog 앱/API 호스트를 입력해 주세요.",
        reverse: true,
      },
      {
        title: "Personal API Key 페이지로 이동",
        paragraphs: [
          "`Settings -> Account -> Personal API keys`로 이동한 뒤 `Create personal API key`를 눌러 주세요.",
          "기존 키가 없다면 목록이 비어 있어도 정상입니다.",
        ],
        imageSrc: "/images/posthog/step2_personal_api_keys.png",
        imageAlt: "PostHog Personal API Keys Page",
      },
      {
        title: "읽기 권한 키 생성",
        paragraphs: [
          "키 이름을 입력하고 `Organization & project access`에서 연결할 프로젝트가 포함되도록 설정해 주세요.",
          "권한은 최소한 `Project`와 `Query`에 `Read`를 부여해 주세요. 연결 테스트에서 접근 오류가 나면 프로젝트 범위도 함께 확인해 주세요.",
        ],
        note: "Personal API Key secret은 생성 직후에만 전체 값을 다시 보여줄 수 있으니 즉시 복사해 안전한 곳에 저장해 주세요.",
        imageSrc: "/images/posthog/step3_create_key_modal.png",
        imageAlt: "PostHog Create Personal API Key Modal",
        reverse: true,
      },
      {
        title: "OneQuery에 입력",
        paragraphs: [
          "복사한 값을 OneQuery의 PostHog 연결 화면에 입력한 뒤 연결 테스트를 실행해 주세요.",
        ],
        bullets: ["Project ID", "Personal API Key", "Host URL"],
      },
    ],
    closingTitle: "연동 준비 완료!",
    closingDescription:
      "이제 OneQuery에서 PostHog 데이터를 안전하게 조회할 수 있습니다.",
  },
  en: {
    title: "PostHog API Guide",
    description:
      "To connect PostHog to OneQuery, collect the Project ID, a Personal API Key, and the correct Host URL from PostHog.",
    steps: [
      {
        title: "Open Project Settings",
        paragraphs: [
          "Open the PostHog project you want to connect, then go to `Settings -> Project -> General`.",
          "The `Project token & ID` section is where you confirm the project details OneQuery needs.",
        ],
        imageSrc: "/images/posthog/step1_project_settings.png",
        imageAlt: "PostHog Project Settings General Page",
      },
      {
        title: "Copy the Project ID and Host URL",
        paragraphs: [
          "Copy the `Project ID` from the `Project token & ID` section.",
          "Use the PostHog app origin as the Host URL: `https://us.posthog.com` for US Cloud, `https://eu.posthog.com` for EU Cloud, or your self-hosted base URL.",
        ],
        note: "Do not use the `api_host` value from the web SDK snippet (`https://us.i.posthog.com`, etc.). OneQuery needs the PostHog app/API host instead.",
        reverse: true,
      },
      {
        title: "Open Personal API Keys",
        paragraphs: [
          "Go to `Settings -> Account -> Personal API keys`, then select `Create personal API key`.",
          "An empty list is expected if your workspace has not created any keys yet.",
        ],
        imageSrc: "/images/posthog/step2_personal_api_keys.png",
        imageAlt: "PostHog Personal API Keys Page",
      },
      {
        title: "Create a Read-Scoped Key",
        paragraphs: [
          "Add a label and make sure `Organization & project access` includes the PostHog project you plan to connect.",
          "Grant at least `Read` access to `Project` and `Query`. If the connection test is denied, verify the project access scope as well.",
        ],
        note: "Copy the secret right away and store it safely. PostHog may only show the full key once.",
        imageSrc: "/images/posthog/step3_create_key_modal.png",
        imageAlt: "PostHog Create Personal API Key Modal",
        reverse: true,
      },
      {
        title: "Enter the Values in OneQuery",
        paragraphs: [
          "Paste the copied values into the OneQuery PostHog setup form, then run the connection test.",
        ],
        bullets: ["Project ID", "Personal API Key", "Host URL"],
      },
    ],
    closingTitle: "Integration Ready!",
    closingDescription: "You can now query PostHog data from OneQuery.",
  },
} satisfies GuideContent;
