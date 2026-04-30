import type { GuideContent } from "./types";

// NOTE: GA4's current Property details page hides the property ID behind a
// copy action instead of showing it as static text.
export const gaGuideContent = {
  providerLabel: "Google Analytics",
  ko: {
    title: "Google Analytics 4 서비스 계정 연결 가이드",
    description:
      "OneQuery의 GA4 연결은 Google Cloud Service Account JSON 키, GA4 Property 접근 권한, 그리고 Property ID가 필요합니다.",
    steps: [
      {
        title: "Google Cloud Service Account 만들기",
        paragraphs: [
          "Google Cloud Console에서 `IAM & Admin` > `Service Accounts`를 열고 `Create service account`를 클릭하세요.",
          "서비스 계정 이름은 자유롭게 정해도 됩니다.",
          "다운로드할 JSON 안의 `client_email` 값이 나중에 GA4 `Property access management`에 추가할 사용자 이메일이 됩니다.",
        ],
        imageSrc: "/images/ga4/step1_service_accounts.png",
        imageAlt: "Google Cloud service accounts page",
      },
      {
        title: "JSON 키 다운로드하기",
        paragraphs: [
          "생성한 서비스 계정을 열고 `Keys` 탭으로 이동하세요.",
          "`Add key` > `Create new key`를 누른 뒤 `JSON`을 선택하세요.",
          "다운로드되는 파일에는 `project_id`, `client_email`, `private_key`, 그리고 경우에 따라 `private_key_id`가 들어 있습니다.",
        ],
        note: "OneQuery 웹 폼은 이 raw Google JSON 파일 자체를 업로드하거나 붙여넣을 수 있습니다.",
        imageSrc: "/images/ga4/step2_create_json_key.png",
        imageAlt: "Google Cloud JSON key type selection",
        reverse: true,
      },
      {
        title: "GA4 Property에 Viewer 권한 추가하기",
        paragraphs: [
          "https://analytics.google.com 에서 `Admin` > `Property access management`를 여세요.",
          "`Add users`를 누르고, 방금 받은 JSON 파일의 `client_email` 값을 이메일 주소로 붙여넣으세요.",
          "표준 역할은 `Viewer`로 두고, `No Cost Metrics`와 `No Revenue Metrics` 체크박스는 선택하지 마세요.",
        ],
        note: "Repo 코드상 OneQuery은 `runReport`로 `activeUsers`를 조회해 연결을 테스트하므로, 최소 읽기 권한인 `Viewer`면 충분합니다.",
        imageSrc: "/images/ga4/step3_add_user_viewer.png",
        imageAlt: "GA4 add user dialog with Viewer role",
      },
      {
        title: "Property ID를 복사해 OneQuery에 넣기",
        paragraphs: [
          "`Admin` > `Property details`로 이동해 `Copy property ID`를 클릭하세요.",
          "OneQuery은 `123456789`처럼 숫자만 넣어도 되고, `properties/123456789` 형태도 받아들입니다.",
          "CLI에서는 raw Google JSON 대신 아래처럼 정규화된 `serviceAccount` 구조를 사용하세요.",
        ],
        code: `{
  "name": "ga_marketing",
  "credentials": {
    "type": "ga",
    "authType": "service_account",
    "propertyId": "123456789",
    "serviceAccount": {
      "projectId": "my-gcp-project",
      "clientEmail": "onequery@my-gcp-project.iam.gserviceaccount.com",
      "privateKeyId": "key-id",
      "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
    }
  }
}`,
        note: "OAuth도 지원되며, 그 경우 repo는 `https://www.googleapis.com/auth/analytics.readonly` 범위의 토큰을 기대합니다.",
        imageSrc: "/images/ga4/step4_property_details.png",
        imageAlt: "GA4 property details page",
        reverse: true,
      },
    ],
    closingTitle: "연결 준비 완료!",
    closingDescription:
      "이제 GA4 Property ID와 서비스 계정 JSON 키를 사용해 OneQuery 연결을 만들 수 있습니다.",
    closingNote:
      "서비스 계정 키가 노출되었다면 즉시 해당 키를 삭제하거나 임시 서비스 계정을 폐기하세요.",
  },
  en: {
    title: "Google Analytics 4 Service Account Guide",
    description:
      "OneQuery's GA4 connection needs a Google Cloud service account JSON key, GA4 property access, and the property ID.",
    steps: [
      {
        title: "Create the Google Cloud service account",
        paragraphs: [
          "In Google Cloud Console, open `IAM & Admin` > `Service Accounts` and click `Create service account`.",
          "Any recognizable service-account name is fine.",
          "The downloaded JSON file will include the `client_email` value that you later add to GA4 as a user.",
        ],
        imageSrc: "/images/ga4/step1_service_accounts.png",
        imageAlt: "Google Cloud service accounts page",
      },
      {
        title: "Download the JSON key",
        paragraphs: [
          "Open the new service account and go to the `Keys` tab.",
          "Click `Add key` > `Create new key`, then keep `JSON` selected.",
          "The downloaded file contains `project_id`, `client_email`, `private_key`, and sometimes `private_key_id`.",
        ],
        note: "The OneQuery web form can accept that raw Google JSON file directly by upload or paste.",
        imageSrc: "/images/ga4/step2_create_json_key.png",
        imageAlt: "Google Cloud JSON key type selection",
        reverse: true,
      },
      {
        title: "Grant Viewer access in GA4",
        paragraphs: [
          "In GA4, open `Admin` > `Property access management`.",
          "Click `Add users`, paste the service-account email from the JSON file's `client_email`, and keep the standard role set to `Viewer`.",
          "Leave `No Cost Metrics` and `No Revenue Metrics` unchecked.",
        ],
        note: "Repo code tests GA by calling `runReport` for `activeUsers`, so the minimal read-only property role, `Viewer`, is enough.",
        imageSrc: "/images/ga4/step3_add_user_viewer.png",
        imageAlt: "GA4 add user dialog with Viewer role",
      },
      {
        title: "Copy the property ID and connect OneQuery",
        paragraphs: [
          "Open `Admin` > `Property details` and click `Copy property ID`.",
          "OneQuery accepts either plain digits such as `123456789` or the prefixed form `properties/123456789`.",
          "For `onequery source connect`, normalize the Google JSON into OneQuery's `serviceAccount` schema as shown below.",
        ],
        code: `{
  "name": "ga_marketing",
  "credentials": {
    "type": "ga",
    "authType": "service_account",
    "propertyId": "123456789",
    "serviceAccount": {
      "projectId": "my-gcp-project",
      "clientEmail": "onequery@my-gcp-project.iam.gserviceaccount.com",
      "privateKeyId": "key-id",
      "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
    }
  }
}`,
        note: "OAuth is also supported, and repo code expects the `https://www.googleapis.com/auth/analytics.readonly` scope for that flow.",
        imageSrc: "/images/ga4/step4_property_details.png",
        imageAlt: "GA4 property details page",
        reverse: true,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "You now have the GA4 property ID, the service-account JSON key, and the exact Viewer permission OneQuery expects.",
    closingNote:
      "If the service-account key was exposed while documenting or sharing setup steps, delete that key or delete the temporary service account.",
  },
} satisfies GuideContent;
