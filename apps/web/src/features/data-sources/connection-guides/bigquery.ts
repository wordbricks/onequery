import type { GuideContent } from "./types";

// NOTE: The live BigQuery flow is service account + IAM roles + JSON key.
// The previous API-key wording was stale and did not match the current UI.
export const bigqueryGuideContent = {
  providerLabel: "BigQuery",
  ko: {
    title: "BigQuery 서비스 계정 연결 가이드",
    description:
      "OneQuery의 BigQuery 연결은 API 키가 아니라 Google Cloud Service Account JSON 키와 정확한 IAM 역할이 필요합니다.",
    steps: [
      {
        title: "Service Accounts 페이지 열기",
        paragraphs: [
          "Google Cloud Console에 로그인한 뒤 대상 BigQuery 프로젝트를 선택하세요: https://console.cloud.google.com",
          "`IAM & Admin` > `Service Accounts`로 이동하고 `Create service account`를 클릭하세요.",
          "서비스 계정 이름은 자유롭게 정해도 됩니다. 이 계정이 나중에 OneQuery의 BigQuery 자격 증명이 됩니다.",
        ],
        imageSrc: "/images/bigquery/step1_service_accounts.png",
        imageAlt: "Google Cloud service accounts page",
      },
      {
        title: "정확한 BigQuery 역할 2개 부여하기",
        paragraphs: [
          "권한 단계에서 `BigQuery Data Viewer`와 `BigQuery Job User`를 둘 다 추가하세요.",
          "첫 번째 역할은 데이터셋 읽기용이고, 두 번째 역할은 쿼리 작업 실행용입니다.",
        ],
        bullets: ["BigQuery Data Viewer", "BigQuery Job User"],
        note: "Repo 코드상 OneQuery은 연결 테스트 때 `SELECT 1 AS onequery_connection_test`를 실행하므로, 읽기 권한만으로는 부족하고 Job 실행 권한도 필요합니다.",
        imageSrc: "/images/bigquery/step2_bigquery_roles.png",
        imageAlt: "Google Cloud BigQuery roles",
        reverse: true,
      },
      {
        title: "Keys 탭에서 JSON 키 만들기",
        paragraphs: [
          "서비스 계정을 만든 뒤 해당 계정 상세 페이지를 열고 `Keys` 탭으로 이동하세요.",
          "`Add key` > `Create new key`를 누르세요.",
        ],
        imageSrc: "/images/bigquery/step3_add_key_menu.png",
        imageAlt: "Google Cloud add key menu",
      },
      {
        title: "JSON 키를 OneQuery 형식으로 넣기",
        paragraphs: [
          "`JSON`을 선택하고 `Create`를 누르면 키 파일이 다운로드됩니다.",
          "웹 가이드는 이 실시간 흐름을 기준으로 작성되었고, OneQuery 웹 폼은 다운로드한 Google Service Account JSON 파일 자체를 바로 업로드하거나 붙여넣을 수 있습니다.",
          'CLI에서는 raw Google JSON을 그대로 넣지 말고, 아래처럼 `authType: "service_account"`와 camelCase `serviceAccount` 필드로 정규화해서 사용하세요.',
        ],
        code: `{
  "name": "bigquery_prod",
  "credentials": {
    "type": "bigquery",
    "authType": "service_account",
    "projectId": "my-gcp-project",
    "serviceAccount": {
      "projectId": "my-gcp-project",
      "clientEmail": "onequery@my-gcp-project.iam.gserviceaccount.com",
      "privateKeyId": "key-id",
      "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
    }
  }
}`,
        note: "OAuth도 지원되지만, 그 경우 repo는 `https://www.googleapis.com/auth/bigquery.readonly` 범위의 토큰을 기대합니다. JSON 키가 노출되었다면 즉시 해당 키를 삭제하거나 서비스 계정을 폐기하세요.",
        imageSrc: "/images/bigquery/step4_create_json_key.png",
        imageAlt: "Google Cloud JSON key type selection",
        reverse: true,
      },
    ],
    closingTitle: "연결 준비 완료!",
    closingDescription:
      "이제 프로젝트 ID와 서비스 계정 JSON 키로 OneQuery BigQuery 연결을 만들 수 있습니다.",
    closingNote:
      "웹 폼은 raw Google JSON을 받아주지만, CLI JSON은 `projectId`와 nested `serviceAccount`를 명시적으로 넣어야 합니다.",
  },
  en: {
    title: "BigQuery Service Account Guide",
    description:
      "OneQuery's BigQuery connection uses a Google Cloud service account JSON key plus the correct IAM roles, not a generic API key.",
    steps: [
      {
        title: "Open the Service Accounts page",
        paragraphs: [
          "Sign in to Google Cloud Console and select the BigQuery project you want OneQuery to query: https://console.cloud.google.com",
          "Open `IAM & Admin` > `Service Accounts`, then click `Create service account`.",
          "You can choose any recognizable service account name. This account becomes OneQuery's BigQuery credential.",
        ],
        imageSrc: "/images/bigquery/step1_service_accounts.png",
        imageAlt: "Google Cloud service accounts page",
      },
      {
        title: "Grant the exact BigQuery roles",
        paragraphs: [
          "In the permissions step, add both `BigQuery Data Viewer` and `BigQuery Job User`.",
          "The first role lets OneQuery read datasets, and the second lets it run query jobs.",
        ],
        bullets: ["BigQuery Data Viewer", "BigQuery Job User"],
        note: "Repo code verifies the connection by running `SELECT 1 AS onequery_connection_test`, so read access alone is not enough. The credential also needs permission to start jobs.",
        imageSrc: "/images/bigquery/step2_bigquery_roles.png",
        imageAlt: "Google Cloud BigQuery roles",
        reverse: true,
      },
      {
        title: "Open the Keys tab and add a key",
        paragraphs: [
          "After the service account is created, open it and go to the `Keys` tab.",
          "Click `Add key` > `Create new key`.",
        ],
        imageSrc: "/images/bigquery/step3_add_key_menu.png",
        imageAlt: "Google Cloud add key menu",
      },
      {
        title: "Use the JSON key in OneQuery's credential shape",
        paragraphs: [
          "Select `JSON` and click `Create` to download the key file.",
          "The OneQuery web form can accept the downloaded Google service-account JSON file directly by upload or paste.",
          'For `onequery source connect`, normalize that file into OneQuery\'s schema with `authType: "service_account"` and camelCase `serviceAccount` fields.',
        ],
        code: `{
  "name": "bigquery_prod",
  "credentials": {
    "type": "bigquery",
    "authType": "service_account",
    "projectId": "my-gcp-project",
    "serviceAccount": {
      "projectId": "my-gcp-project",
      "clientEmail": "onequery@my-gcp-project.iam.gserviceaccount.com",
      "privateKeyId": "key-id",
      "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
    }
  }
}`,
        note: "OAuth is also accepted, but repo code expects `https://www.googleapis.com/auth/bigquery.readonly` for that flow. If a JSON key appears in a screenshot or chat, delete the key or delete the temporary service account.",
        imageSrc: "/images/bigquery/step4_create_json_key.png",
        imageAlt: "Google Cloud JSON key type selection",
        reverse: true,
      },
    ],
    closingTitle: "Ready to Connect",
    closingDescription:
      "You now have the project ID, service-account roles, and JSON key shape that OneQuery expects for BigQuery.",
    closingNote:
      "The web form can normalize raw Google JSON, but the CLI payload must include both the top-level `projectId` and the nested `serviceAccount` object.",
  },
} satisfies GuideContent;
