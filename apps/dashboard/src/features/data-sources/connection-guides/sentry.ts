import type { GuideContent } from "./types";

// Live Sentry UI currently exposes this flow under Personal Tokens, and the
// permission preview shows event:read rather than a separate issue scope.
export const sentryGuideContent = {
  providerLabel: "Sentry",
  ko: {
    title: "Sentry Personal Token 연결 가이드",
    description:
      "OneQuery의 Sentry 연결은 `authToken`, `organizationSlug`, optional `projectSlug`, optional `apiBaseUrl`를 받습니다. 아래 단계대로 Sentry Personal Token과 slug 값을 확인해 주세요.",
    steps: [
      {
        title: "Personal Tokens 페이지 열기",
        paragraphs: [
          "Sentry에 로그인한 뒤 Settings > Developer Settings > Personal Tokens로 이동해 주세요.",
          "직접 열려면 https://sentry.io/settings/account/api/auth-tokens/ 를 사용해도 됩니다.",
        ],
        note: "목록이 비어 있어도 괜찮습니다. `Create New Token`으로 바로 다음 단계로 이동할 수 있습니다.",
        imageSrc: "/images/sentry/step1_personal_tokens.png",
        imageAlt: "Sentry Personal Tokens page",
      },
      {
        title: "필요한 읽기 권한으로 토큰 생성",
        paragraphs: [
          "`Create New Token`을 누르고 이름은 `OneQuery`처럼 알아보기 쉽게 입력해 주세요.",
          "권한은 `Project = Read`, `Issue & Event = Read`, `Organization = Read`로 설정해 주세요.",
        ],
        bullets: [
          "`Project = Read` -> `project:read`",
          "`Issue & Event = Read` -> `event:read`",
          "`Organization = Read` -> `organization:read`",
        ],
        note: "Sentry는 토큰 값을 한 번만 보여줍니다. `Create Token` 후 즉시 복사하고, 스크린샷이나 채팅에 노출하지 마세요.",
        imageSrc: "/images/sentry/step2_create_token_permissions.png",
        imageAlt: "Sentry personal token permission selection",
        reverse: true,
      },
      {
        title: "Organization Slug 확인",
        paragraphs: [
          "Settings > Organization > General의 `Organization Slug` 값을 `organizationSlug`로 사용해 주세요.",
          "`projectSlug`를 비워 두면 OneQuery은 연결 테스트에서 `/organizations/{organizationSlug}/projects/`로 조직 접근만 확인합니다.",
        ],
        imageSrc: "/images/sentry/step3_organization_slug.png",
        imageAlt:
          "Sentry organization settings showing the Organization Slug field",
      },
      {
        title: "Project Slug 확인 후 OneQuery에 입력",
        paragraphs: [
          "특정 프로젝트에 연결을 고정하려면 Settings > Projects > <project> > General의 `Slug` 값을 `projectSlug`에 넣어 주세요.",
          "`projectSlug`를 넣으면 OneQuery은 `/projects/{organizationSlug}/{projectSlug}/events/`로 프로젝트 접근을 확인하므로 `Issue & Event = Read`가 필요합니다.",
          "Sentry Cloud는 `apiBaseUrl`를 비워 두면 되고, self-hosted Sentry만 `https://<your-host>/api/0`를 넣어 주세요.",
        ],
        bullets: [
          "`authToken`: 방금 생성한 Personal Token",
          "`organizationSlug`: Organization Settings의 Slug",
          "`projectSlug` (optional): Project Settings의 Slug",
          "`apiBaseUrl` (optional): self-hosted API root",
        ],
        code: `{
  "name": "sentry_main",
  "credentials": {
    "type": "sentry",
    "authToken": "sntrys_...",
    "organizationSlug": "your-org-slug",
    "projectSlug": "your-project-slug"
  }
}`,
        note: "Self-hosted Sentry라면 `credentials.apiBaseUrl`에 `https://<your-host>/api/0`를 추가하세요.",
        imageSrc: "/images/sentry/step4_project_slug.png",
        imageAlt: "Sentry project settings showing the Slug field",
        reverse: true,
      },
    ],
    closingTitle: "준비가 완료되었습니다!",
    closingDescription:
      "이제 생성한 Personal Token과 slug 값을 OneQuery 웹 폼이나 `onequery source connect --source sentry` 입력 JSON에 넣으면 됩니다.",
    closingNote:
      "`projectSlug` 없이 연결하면 조직 프로젝트 목록 접근부터 확인하고, `projectSlug`를 넣으면 프로젝트 이벤트 접근까지 바로 확인합니다.",
  },
  en: {
    title: "Sentry Personal Token Connection Guide",
    description:
      "The OneQuery Sentry connection accepts `authToken`, `organizationSlug`, optional `projectSlug`, and optional `apiBaseUrl`. Follow the live Sentry Personal Token flow below.",
    steps: [
      {
        title: "Open the Personal Tokens page",
        paragraphs: [
          "Sign in to Sentry, then open Settings > Developer Settings > Personal Tokens.",
          "You can also open https://sentry.io/settings/account/api/auth-tokens/ directly.",
        ],
        note: "It is fine if the list is empty. Click `Create New Token` to continue.",
        imageSrc: "/images/sentry/step1_personal_tokens.png",
        imageAlt: "Sentry Personal Tokens page",
      },
      {
        title: "Create the token with the required read permissions",
        paragraphs: [
          "Click `Create New Token` and give it a recognizable name such as `OneQuery`.",
          "Set `Project = Read`, `Issue & Event = Read`, and `Organization = Read`.",
        ],
        bullets: [
          "`Project = Read` -> `project:read`",
          "`Issue & Event = Read` -> `event:read`",
          "`Organization = Read` -> `organization:read`",
        ],
        note: "Sentry only shows the token value once after you click `Create Token`. Copy it immediately and do not leave it in screenshots or chat.",
        imageSrc: "/images/sentry/step2_create_token_permissions.png",
        imageAlt: "Sentry personal token permission selection",
        reverse: true,
      },
      {
        title: "Find the organization slug",
        paragraphs: [
          "Read the `Organization Slug` value from Settings > Organization > General and use it as `organizationSlug`.",
          "If you leave `projectSlug` empty, OneQuery validates organization access with `/organizations/{organizationSlug}/projects/` during connect.",
        ],
        imageSrc: "/images/sentry/step3_organization_slug.png",
        imageAlt:
          "Sentry organization settings showing the Organization Slug field",
      },
      {
        title: "Find the project slug and enter the fields in OneQuery",
        paragraphs: [
          "If you want to pin the connection to one project, read the `Slug` value from Settings > Projects > <project> > General and use it as `projectSlug`.",
          "When `projectSlug` is present, OneQuery validates project access with `/projects/{organizationSlug}/{projectSlug}/events/`, so `Issue & Event = Read` is required.",
          "Leave `apiBaseUrl` empty for Sentry Cloud. Only set it for self-hosted Sentry, using the canonical API root such as `https://<your-host>/api/0`.",
        ],
        bullets: [
          "`authToken`: the Personal Token you just created",
          "`organizationSlug`: the slug from Organization Settings",
          "`projectSlug` (optional): the slug from Project Settings",
          "`apiBaseUrl` (optional): self-hosted API root",
        ],
        code: `{
  "name": "sentry_main",
  "credentials": {
    "type": "sentry",
    "authToken": "sntrys_...",
    "organizationSlug": "your-org-slug",
    "projectSlug": "your-project-slug"
  }
}`,
        note: "For self-hosted Sentry, also add `credentials.apiBaseUrl`, for example `https://<your-host>/api/0`.",
        imageSrc: "/images/sentry/step4_project_slug.png",
        imageAlt: "Sentry project settings showing the Slug field",
        reverse: true,
      },
    ],
    closingTitle: "Ready to Go!",
    closingDescription:
      "Paste the Personal Token and slug values into the OneQuery form or `onequery source connect --source sentry` JSON payload to finish the setup.",
    closingNote:
      "Without `projectSlug`, OneQuery checks organization-level project access first. With `projectSlug`, it also checks project event access during connect.",
  },
} satisfies GuideContent;
