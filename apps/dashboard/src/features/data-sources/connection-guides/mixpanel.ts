import type { GuideContent } from "./types";

// NOTE: Mixpanel's live org-level flow now defaults to `Member` + `Consumer`.
// The previous guide's `Analyst` wording was stale and did not match the UI.
export const mixpanelGuideContent = {
  providerLabel: "Mixpanel",
  ko: {
    title: "Mixpanel 서비스 계정 연결 가이드",
    description:
      "OneQuery에 Mixpanel을 연결하려면 조직 단위 Service Account와 대상 Project ID가 필요합니다.",
    steps: [
      {
        title: "Organization Service Accounts 열기",
        paragraphs: [
          "Mixpanel에 로그인해 주세요: https://mixpanel.com",
          "Settings를 연 뒤 `Org` 탭으로 이동하고, 좌측 메뉴에서 `Service Accounts`를 선택하세요.",
          "우측 상단의 `Add Service Account`를 클릭해 새 계정을 만드세요.",
        ],
        imageSrc: "/images/mixpanel/step1_service_accounts.png",
        imageAlt: "Mixpanel organization service accounts page",
      },
      {
        title: "Service Account 생성하기",
        paragraphs: [
          "이름을 입력한 뒤 `Organization Role`은 `Member`로 두세요.",
          "연결할 프로젝트를 선택하고 `Project Role`은 `Consumer`로 유지하세요.",
          "`Expires`는 `Never`로 둘 수 있고, 조직 정책이 있다면 더 짧은 만료일을 선택해도 됩니다.",
        ],
        note: "OneQuery의 Mixpanel 연결은 프로젝트 접근 권한과 읽기 가능한 서비스 계정 자격 증명만 필요합니다.",
        imageSrc: "/images/mixpanel/step2_create_service_account.png",
        imageAlt: "Mixpanel create service account modal",
        reverse: true,
      },
      {
        title: "Username과 Secret 저장하기",
        paragraphs: [
          "생성 직후 표시되는 `Username`과 `Secret`을 복사해 두세요.",
          "OneQuery에서는 이 값을 각각 `credentials.username`, `credentials.secret`에 입력합니다.",
        ],
        note: "Secret은 이 화면을 닫으면 다시 볼 수 없습니다. 스크린샷이나 채팅에 노출되었다면 해당 계정을 폐기하거나 Secret을 다시 발급하세요.",
        imageSrc: "/images/mixpanel/step3_credentials.png",
        imageAlt: "Mixpanel service account credentials",
      },
      {
        title: "Project ID와 Region 확인하기",
        paragraphs: [
          "Settings의 `Project` 탭 `Overview`에서 `Project ID`를 복사해 `credentials.projectId`에 넣으세요.",
          "`Data Residency`를 보고 `US -> us`, `EU -> eu`, `India -> in`으로 `credentials.region`을 맞추세요.",
          "`workspaceId`는 선택 사항입니다. 특정 Mixpanel workspace/data view를 강제로 쓰는 경우가 아니면 비워 두면 됩니다.",
        ],
        code: `{
  "name": "mixpanel_growth",
  "credentials": {
    "type": "mixpanel",
    "projectId": "12345",
    "username": "service-account-username",
    "secret": "service-account-secret",
    "region": "us"
  }
}`,
        note: "`onequery source connect --source mixpanel --input '<json>'`에서 위 JSON을 그대로 사용하고, 필요할 때만 `workspaceId`를 추가하세요.",
        imageSrc: "/images/mixpanel/step4_project_settings.png",
        imageAlt:
          "Mixpanel project settings with project ID and data residency",
        reverse: true,
      },
    ],
    closingTitle: "연결 준비 완료!",
    closingDescription:
      "이제 Mixpanel Service Account 자격 증명과 Project ID로 OneQuery 연결을 마칠 수 있습니다.",
    closingNote:
      "서비스 계정 Secret이 한 번이라도 노출되었다면 즉시 삭제하거나 새로 발급하는 것이 안전합니다.",
  },
  en: {
    title: "Mixpanel Service Account Guide",
    description:
      "To connect Mixpanel to OneQuery, create an org-level service account and collect the target project ID.",
    steps: [
      {
        title: "Open Organization Service Accounts",
        paragraphs: [
          "Sign in to Mixpanel at https://mixpanel.com",
          "Open Settings, switch to the `Org` tab, and choose `Service Accounts` from the left navigation.",
          "Click `Add Service Account` in the top-right corner.",
        ],
        imageSrc: "/images/mixpanel/step1_service_accounts.png",
        imageAlt: "Mixpanel organization service accounts page",
      },
      {
        title: "Create the service account",
        paragraphs: [
          "Enter a name, keep `Organization Role` set to `Member`, and select the project that OneQuery should read.",
          "Keep `Project Role` set to `Consumer`.",
          "Leave `Expires` as `Never`, or choose a shorter expiration if your security policy requires rotation.",
        ],
        note: "OneQuery only needs project access plus working read credentials for the Mixpanel Query API.",
        imageSrc: "/images/mixpanel/step2_create_service_account.png",
        imageAlt: "Mixpanel create service account modal",
        reverse: true,
      },
      {
        title: "Copy the username and secret",
        paragraphs: [
          "After you create the account, Mixpanel shows the `Username` and `Secret` once.",
          "Use them as `credentials.username` and `credentials.secret` in OneQuery.",
        ],
        note: "Treat the secret as compromised if it appears in a screenshot or chat. Delete the account or rotate the secret and create a new one.",
        imageSrc: "/images/mixpanel/step3_credentials.png",
        imageAlt: "Mixpanel service account credentials",
      },
      {
        title: "Copy the project ID and choose the region",
        paragraphs: [
          "Open Settings > `Project` > `Overview`, then copy `Project ID` into `credentials.projectId`.",
          "Map `Data Residency` to OneQuery's `region` value: `US -> us`, `EU -> eu`, `India -> in`.",
          "Leave `workspaceId` empty unless you already know that your Mixpanel setup requires a specific workspace or data view override.",
        ],
        code: `{
  "name": "mixpanel_growth",
  "credentials": {
    "type": "mixpanel",
    "projectId": "12345",
    "username": "service-account-username",
    "secret": "service-account-secret",
    "region": "us"
  }
}`,
        note: "Run `onequery source connect --source mixpanel --input '<json>'` with that payload, and add `workspaceId` only when you intentionally need it.",
        imageSrc: "/images/mixpanel/step4_project_settings.png",
        imageAlt:
          "Mixpanel project settings with project ID and data residency",
        reverse: true,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "You now have the exact Mixpanel fields OneQuery expects: username, secret, project ID, and region.",
    closingNote:
      "If the one-time secret was exposed while documenting or sharing setup steps, revoke or delete that temporary service account.",
  },
} satisfies GuideContent;
