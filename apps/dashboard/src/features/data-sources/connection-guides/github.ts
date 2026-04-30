import type { GuideContent } from "./types";

export const githubGuideContent = {
  providerLabel: "GitHub",
  ko: {
    title: "GitHub Fine-grained Token 생성 가이드",
    description:
      "OneQuery에 GitHub를 연결하려면 선택한 저장소만 읽을 수 있는 Fine-grained personal access token이 필요합니다.",
    steps: [
      {
        title: "GitHub 토큰 생성 페이지 열기",
        paragraphs: [
          "GitHub에 로그인한 뒤 다음 페이지로 이동하세요: https://github.com/settings/personal-access-tokens/new",
          "좌측 메뉴에서 Settings > Developer settings > Personal access tokens > Fine-grained tokens 경로로 들어가도 됩니다.",
        ],
        imageSrc: "/images/github-token-guide/step1_signin.png",
        imageAlt: "GitHub sign-in page for personal access tokens",
      },
      {
        title: "토큰 기본 정보 입력",
        paragraphs: [
          "Token name에는 `OneQuery`처럼 알아보기 쉬운 이름을 입력하세요.",
          "Resource owner는 연결할 저장소를 소유한 계정 또는 조직으로 선택하세요.",
          "Expiration을 정하고, Repository access는 `Only select repositories`로 설정한 뒤 OneQuery이 읽을 저장소를 선택하세요.",
        ],
        note: "Description은 선택 사항이지만 `Read-only token for OneQuery`처럼 적어두면 관리가 쉽습니다.",
        imageSrc:
          "/images/github-token-guide/step2_new_fine_grained_token_sanitized.png",
        imageAlt: "GitHub fine-grained token form",
        reverse: true,
      },
      {
        title: "읽기 전용 권한 설정",
        paragraphs: [
          "Permissions 섹션에서 Add permissions를 클릭하세요.",
          "`Contents`, `Issues`, `Pull requests`를 모두 `Read-only`로 설정하세요.",
          "GitHub가 자동으로 요구하는 `Metadata: Read-only`도 함께 포함됩니다.",
        ],
        note: "이 설정이면 OneQuery이 저장소 내용을 읽고, 이슈와 PR 데이터를 조회할 수 있습니다.",
        imageSrc:
          "/images/github-token-guide/step3_permissions_configured_sanitized.png",
        imageAlt: "GitHub repository permissions configured for OneQuery",
      },
      {
        title: "토큰 복사 후 OneQuery에 연결",
        paragraphs: [
          "Generate token을 누른 뒤 표시되는 토큰 값을 즉시 복사하세요. GitHub는 이 값을 다시 보여주지 않습니다.",
          "복사한 값을 `onequery source connect --source github --input '<json>'`의 `credentials.accessToken`에 넣어 연결하세요.",
        ],
        code: `{
  "name": "github_main",
  "credentials": {
    "type": "github",
    "accessToken": "github_pat_..."
  }
}`,
        note: "토큰 값은 민감 정보입니다. 채팅이나 스크린샷에 노출되었다면 즉시 폐기하고 새 토큰을 발급하세요.",
        imageSrc:
          "/images/github-token-guide/step4_token_created_sanitized.png",
        imageAlt: "GitHub one-time personal access token copy screen",
        reverse: true,
      },
    ],
    closingTitle: "연결 준비 완료!",
    closingDescription:
      "이제 생성한 토큰을 OneQuery GitHub 연결 화면이나 CLI 입력 JSON에 넣으면 됩니다.",
    closingNote:
      "필요한 저장소만 선택하고 Read-only 권한만 부여하는 것이 가장 안전합니다.",
  },
  en: {
    title: "GitHub Fine-Grained Token Guide",
    description:
      "To connect GitHub to OneQuery, create a fine-grained personal access token with read-only access to the repositories you want OneQuery to query.",
    steps: [
      {
        title: "Open the GitHub token page",
        paragraphs: [
          "Sign in to GitHub, then open https://github.com/settings/personal-access-tokens/new",
          "You can also navigate there from Settings > Developer settings > Personal access tokens > Fine-grained tokens.",
        ],
        imageSrc: "/images/github-token-guide/step1_signin.png",
        imageAlt: "GitHub sign-in page for personal access tokens",
      },
      {
        title: "Fill in the token details",
        paragraphs: [
          "Set `Token name` to something recognizable such as `OneQuery`.",
          "Choose the account or organization that owns the repositories as the `Resource owner`.",
          "Set an expiration, choose `Only select repositories`, and select the repositories that OneQuery should read.",
        ],
        note: "The description is optional, but `Read-only token for OneQuery` makes the token easier to identify later.",
        imageSrc:
          "/images/github-token-guide/step2_new_fine_grained_token_sanitized.png",
        imageAlt: "GitHub fine-grained token form",
        reverse: true,
      },
      {
        title: "Grant read-only repository permissions",
        paragraphs: [
          "In the Permissions section, click Add permissions.",
          "Set `Contents`, `Issues`, and `Pull requests` to `Read-only`.",
          "GitHub also includes the required `Metadata: Read-only` permission.",
        ],
        note: "These permissions let OneQuery read repository contents plus issue and pull request data without write access.",
        imageSrc:
          "/images/github-token-guide/step3_permissions_configured_sanitized.png",
        imageAlt: "GitHub repository permissions configured for OneQuery",
      },
      {
        title: "Copy the token and connect OneQuery",
        paragraphs: [
          "Click Generate token, then copy the token value immediately. GitHub only shows it once.",
          "Use that value as `credentials.accessToken` in `onequery source connect --source github --input '<json>'`.",
        ],
        code: `{
  "name": "github_main",
  "credentials": {
    "type": "github",
    "accessToken": "github_pat_..."
  }
}`,
        note: "Treat the token as sensitive. If it appears in a screenshot or chat, revoke it and create a new one.",
        imageSrc:
          "/images/github-token-guide/step4_token_created_sanitized.png",
        imageAlt: "GitHub one-time personal access token copy screen",
        reverse: true,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "Paste the token into the OneQuery GitHub connection form or the CLI JSON payload to finish the setup.",
    closingNote:
      "For least privilege, keep repository access limited to the repos you actually want OneQuery to read.",
  },
} satisfies GuideContent;
