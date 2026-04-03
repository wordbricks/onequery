import { useState } from "react";

import { APP_API_PATH } from "@/lib/api-paths";
import { getBrowserOrigin } from "@/lib/browser-origin";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";

import type { ProviderType } from "./data-source-provider-metadata";

const CONNECTOR_BASE_URL_TOKEN = "__ONEQUERY_CONNECTOR_BASE_URL__";

interface GuideStep {
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  code?: string;
  note?: string;
  imageSrc?: string;
  imageAlt?: string;
  reverse?: boolean;
}

interface GuideLocaleContent {
  title: string;
  description: string;
  steps: readonly GuideStep[];
  closingTitle?: string;
  closingDescription?: string;
  closingNote?: string;
}

interface GuideContent {
  providerLabel: string;
  ko?: GuideLocaleContent;
  en?: GuideLocaleContent;
}

const GUIDE_CONTENT: Record<ProviderType, GuideContent> = {
  // NOTE: Amplitude's current UI splits this flow across `Projects` and
  // org-level `API Keys`, so the old single-page key guide was stale.
  amplitude: {
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
  },
  aws_athena_connector: {
    providerLabel: "AWS Athena Connector",
    ko: {
      title: "AWS Athena Connector Connection Guide",
      description:
        "먼저 고객 AWS 환경에 OneQuery Connector를 배포하고, 커넥터가 발급받은 Connector ID와 Athena 설정값을 OneQuery에 입력해야 합니다.",
      steps: [
        {
          title: "AWS에 커넥터 배포",
          paragraphs: [
            "OneQuery Connector는 고객 AWS 계정 안에서 실행되어 Athena에 직접 질의합니다.",
            "EC2, ECS, 혹은 다른 실행 환경에 커넥터를 띄우고 아래 환경 변수를 설정해 주세요.",
          ],
          code: `ONEQUERY_BASE_URL=${CONNECTOR_BASE_URL_TOKEN}
CONNECTOR_ENROLLMENT_TOKEN=<issued-by-onequery>
ORGANIZATION_ID=<your-onequery-organization-id>
AWS_REGION=<athena-region>`,
          note: "커넥터는 등록 후 주기적으로 heartbeat를 보내므로 외부에서 Athena 자격증명을 OneQuery에 직접 저장할 필요가 없습니다.",
        },
        {
          title: "Connector ID 확인",
          paragraphs: [
            "커넥터가 정상 등록되면 로그에 connector.registration.succeeded 와 함께 Connector ID가 출력됩니다.",
            "OneQuery의 Connector ID 입력칸에는 이 값을 그대로 넣어 주세요.",
          ],
          code: `connector.registration.succeeded
connectorId=connector_12345678-abcd-ef01-2345-6789abcdef01`,
          note: "커넥터를 삭제 후 다시 등록하면 Connector ID가 바뀔 수 있습니다. 그 경우 OneQuery 데이터소스 설정도 새 ID로 업데이트해야 합니다.",
        },
        {
          title: "Athena Database 입력",
          paragraphs: [
            "Athena Database에는 Athena 콘솔 또는 AWS Glue Data Catalog에 보이는 데이터베이스 이름을 입력합니다.",
            "즉, 쿼리에서 FROM 앞에 붙는 카탈로그 내 데이터베이스 이름입니다. 테이블 이름이나 S3 버킷 이름을 넣는 칸이 아닙니다.",
          ],
          bullets: [
            "예: analytics",
            "예: prod_events",
            "현재 Dev 테스트 환경 예시: onequery_connector_test",
          ],
          code: `-- database가 analytics 라면
SELECT * FROM analytics.orders LIMIT 10;`,
        },
        {
          title: "Athena Workgroup 입력",
          paragraphs: [
            "Workgroup은 선택값입니다. 별도 워크그룹을 운영 중이면 그 이름을 입력하고, 아니라면 비워 두거나 기본값 primary를 사용하면 됩니다.",
            "커넥터 IAM 권한과 Athena 설정이 해당 워크그룹에서 쿼리 실행을 허용해야 합니다.",
          ],
          bullets: [
            "비워두면 커넥터 기본값 또는 Athena 기본 워크그룹을 사용합니다.",
            "현재 Dev 테스트 환경 예시: onequery_connector_test",
          ],
        },
        {
          title: "OneQuery에서 연결 테스트",
          paragraphs: [
            "OneQuery Integration 페이지에서 AWS Athena Connector 데이터소스를 생성한 뒤 Test Connection을 실행합니다.",
            "성공하면 OneQuery은 이 데이터소스를 다른 데이터베이스 데이터소스와 동일하게 쿼리할 수 있습니다.",
          ],
          note: "만약 Connector query failed 또는 AWS_ACCESS_DENIED가 발생하면, 커넥터 실행 IAM 역할에 athena:StartQueryExecution, athena:GetQueryExecution, athena:GetQueryResults, Glue 조회 권한, 결과 S3 쓰기 권한이 있는지 확인해 주세요.",
        },
      ],
      closingTitle: "입력값 요약",
      closingDescription:
        "Connector ID에는 커넥터 등록 로그의 ID를, Athena Database에는 조회할 Athena/Glue 데이터베이스 이름을 입력합니다.",
      closingNote:
        "현재 Dev 테스트 환경 기준 입력 예시는 Connector ID: 등록된 connector_* 값, Athena Database: onequery_connector_test, Athena Workgroup: onequery_connector_test 입니다.",
    },
    en: {
      title: "AWS Athena Connector Connection Guide",
      description:
        "Deploy the OneQuery Connector inside the customer's AWS environment first, then enter the registered Connector ID and Athena settings in OneQuery.",
      steps: [
        {
          title: "Deploy the connector in AWS",
          paragraphs: [
            "The OneQuery Connector runs inside the customer's AWS account and queries Athena directly.",
            "Run the connector on EC2, ECS, or another compute environment and configure the following environment variables.",
          ],
          code: `ONEQUERY_BASE_URL=${CONNECTOR_BASE_URL_TOKEN}
CONNECTOR_ENROLLMENT_TOKEN=<issued-by-onequery>
ORGANIZATION_ID=<your-onequery-organization-id>
AWS_REGION=<athena-region>`,
          note: "After enrollment, the connector sends heartbeats to OneQuery. You do not store Athena credentials directly in OneQuery.",
        },
        {
          title: "Find the Connector ID",
          paragraphs: [
            "After successful enrollment, the connector logs print connector.registration.succeeded with a Connector ID.",
            "Paste that exact value into the Connector ID field in OneQuery.",
          ],
          code: `connector.registration.succeeded
connectorId=connector_12345678-abcd-ef01-2345-6789abcdef01`,
          note: "If the connector is recreated, the Connector ID can change. Update the OneQuery data source to the new value in that case.",
        },
        {
          title: "What to enter for Athena Database",
          paragraphs: [
            "Enter the Athena database name shown in the Athena console or AWS Glue Data Catalog.",
            "This is the database portion of the SQL path. Do not enter a table name or an S3 bucket name here.",
          ],
          bullets: [
            "Example: analytics",
            "Example: prod_events",
            "Current Dev test environment example: onequery_connector_test",
          ],
          code: `-- if the database is analytics
SELECT * FROM analytics.orders LIMIT 10;`,
        },
        {
          title: "What to enter for Athena Workgroup",
          paragraphs: [
            "The workgroup field is optional. Enter it only if your Athena queries must run in a specific workgroup.",
            "If you do not use a dedicated workgroup, leave it blank or use the default workgroup primary.",
          ],
          bullets: [
            "Leave it empty to use the connector default or Athena default workgroup.",
            "Current Dev test environment example: onequery_connector_test",
          ],
        },
        {
          title: "Run Test Connection in OneQuery",
          paragraphs: [
            "Create the AWS Athena Connector data source in the OneQuery Integration page and run Test Connection.",
            "When the test succeeds, OneQuery can query Athena through this connector the same way it queries other database-style data sources.",
          ],
          note: "If you see Connector query failed or AWS_ACCESS_DENIED, verify the connector IAM role allows athena:StartQueryExecution, athena:GetQueryExecution, athena:GetQueryResults, Glue read access, and S3 write access for Athena query results.",
        },
      ],
      closingTitle: "Field summary",
      closingDescription:
        "Connector ID should be the ID printed by the connector enrollment log, and Athena Database should be the Athena/Glue database name you want OneQuery to query.",
      closingNote:
        "For the current Dev test environment, the example values are Connector ID: the registered connector_* value, Athena Database: onequery_connector_test, Athena Workgroup: onequery_connector_test.",
    },
  },
  // NOTE: The live BigQuery flow is service account + IAM roles + JSON key.
  // The previous API-key wording was stale and did not match the current UI.
  bigquery: {
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
  },
  // NOTE: GA4's current Property details page hides the property ID behind a
  // copy action instead of showing it as static text.
  ga: {
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
  },
  github: {
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
  },
  laminar: {
    providerLabel: "Laminar",
  },
  // NOTE: Mixpanel's live org-level flow now defaults to `Member` + `Consumer`.
  // The previous guide's `Analyst` wording was stale and did not match the UI.
  mixpanel: {
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
  },
  mongodb: {
    providerLabel: "MongoDB",
  },
  mysql: {
    providerLabel: "MySQL",
    ko: {
      title: "AWS RDS 읽기 전용 계정 생성",
      description:
        "OneQuery이 데이터베이스를 안전하게 분석할 수 있도록 Read-only 권한을 가진 계정을 생성해 주세요.",
      steps: [
        {
          title: "데이터베이스 접속하기",
          paragraphs: [
            "사용 중인 데이터베이스 클라이언트(DBeaver, pgAdmin 등)나 터미널을 이용해 AWS RDS의 Admin 계정으로 접속해 주세요.",
            "접속 후 SQL 쿼리를 실행할 수 있는 에디터 창을 열어주세요.",
          ],
          imageSrc: "/images/rds/step1_connect.png",
          imageAlt: "Database Client Connection",
        },
        {
          title: "읽기 전용 유저 생성 (SQL)",
          paragraphs: ["아래 SQL 명령어를 복사하여 실행해 주세요."],
          code: `CREATE USER onequery_reader WITH PASSWORD 'your_secure_password';
-- DB 접속 권한 부여
GRANT CONNECT ON DATABASE your_db_name TO onequery_reader;`,
          note: "'your_secure_password'와 'your_db_name'을 실제 값으로 변경해 주세요.",
          imageSrc: "/images/rds/step2_create_user.png",
          imageAlt: "SQL Create User Query",
          reverse: true,
        },
        {
          title: "조회 권한 부여 (SQL)",
          paragraphs: ["생성한 유저에게 테이블 조회 권한을 부여합니다."],
          code: `-- PostgreSQL의 경우:
GRANT USAGE ON SCHEMA public TO onequery_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onequery_reader;

-- MySQL의 경우:
GRANT SELECT ON your_db_name.* TO 'onequery_reader';`,
          note: "이 명령어는 현재 존재하는 테이블에 대해서만 권한을 부여합니다.",
          imageSrc: "/images/rds/step3_grant.png",
          imageAlt: "SQL Grant Privileges Query",
        },
        {
          title: "연결 정보 입력",
          paragraphs: ["OneQuery에 다음 정보를 입력해 주세요:"],
          bullets: [
            "Host (Endpoint): adb-xxx...aws.com",
            "Database Name: your_db_name",
            "Username: onequery_reader",
            "Password: 설정한 비밀번호",
          ],
          imageSrc: "/images/rds/step4_info.png",
          imageAlt: "Connection Details Form",
          reverse: true,
        },
      ],
      closingTitle: "설정이 완료되었습니다!",
      closingDescription:
        "이제 OneQuery을 통해 RDS 데이터를 안전하게 분석할 수 있습니다.",
    },
    en: {
      title: "AWS RDS Read-Only Account Guide",
      description:
        "Create a Read-only account so OneQuery can safely analyze your database.",
      steps: [
        {
          title: "Connect to Database",
          paragraphs: [
            "Use your database client (DBeaver, pgAdmin, etc.) or terminal to connect to the Admin account of your AWS RDS.",
            "After connecting, open an editor window where you can execute SQL queries.",
          ],
          imageSrc: "/images/rds/step1_connect.png",
          imageAlt: "Database Client Connection",
        },
        {
          title: "Create Read-Only User (SQL)",
          paragraphs: ["Copy and execute the SQL command below."],
          code: `CREATE USER onequery_reader WITH PASSWORD 'your_secure_password';
-- Grant DB connection privileges
GRANT CONNECT ON DATABASE your_db_name TO onequery_reader;`,
          note: "Please change 'your_secure_password' and 'your_db_name' to actual values.",
          imageSrc: "/images/rds/step2_create_user.png",
          imageAlt: "SQL Create User Query",
          reverse: true,
        },
        {
          title: "Grant Select Privileges (SQL)",
          paragraphs: ["Grant table select privileges to the created user."],
          code: `-- For PostgreSQL:
GRANT USAGE ON SCHEMA public TO onequery_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onequery_reader;

-- For MySQL:
GRANT SELECT ON your_db_name.* TO 'onequery_reader';`,
          note: "This command grants privileges only for currently existing tables.",
          imageSrc: "/images/rds/step3_grant.png",
          imageAlt: "SQL Grant Privileges Query",
        },
        {
          title: "Enter Connection Details",
          paragraphs: ["Please enter the following information into OneQuery:"],
          bullets: [
            "Host (Endpoint): adb-xxx...aws.com",
            "Database Name: your_db_name",
            "Username: onequery_reader",
            "Password: Set password",
          ],
          imageSrc: "/images/rds/step4_info.png",
          imageAlt: "Connection Details Form",
          reverse: true,
        },
      ],
      closingTitle: "Setup Complete!",
      closingDescription: "You can now securely analyze RDS data via OneQuery.",
    },
  },
  postgres: {
    providerLabel: "PostgreSQL",
    ko: {
      title: "PostgreSQL 연동 가이드",
      description:
        "PostgreSQL 데이터베이스의 연결 정보(Host, DB Name 등)를 확인하고 읽기 전용 사용자를 생성해 주세요.",
      steps: [
        {
          title: "읽기 전용 사용자 생성",
          paragraphs: [
            "데이터베이스의 안전을 위해 OneQuery 전용 읽기 권한 사용자를 생성하는 것을 권장합니다.",
            "다음 SQL 명령어를 실행하여 사용자를 생성하고 권한을 부여하세요.",
          ],
          code: `-- 사용자 생성
CREATE USER onequery_readonly WITH PASSWORD 'secure_password';

-- 읽기 권한 부여
GRANT CONNECT ON DATABASE your_database TO onequery_readonly;
GRANT USAGE ON SCHEMA public TO onequery_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onequery_readonly;

-- 향후 생성될 테이블에도 권한 자동 부여 (선택)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO onequery_readonly;`,
          imageSrc: "/images/postgresql/step1_create_user.png",
          imageAlt: "PostgreSQL Create User SQL",
        },
        {
          title: "연결 정보 확인",
          paragraphs: ["다음 정보를 준비해 주세요:"],
          bullets: [
            "Host: 데이터베이스 주소 (예: db.example.com)",
            "Port: 기본값은 5432 입니다.",
            "Database Name: 연결할 데이터베이스 이름",
            "Username: onequery_readonly",
            "Password: 설정한 비밀번호",
          ],
          imageSrc: "/images/postgresql/step2_connection.png",
          imageAlt: "PostgreSQL Connection Form",
          reverse: true,
        },
      ],
    },
    en: {
      title: "PostgreSQL Integration Guide",
      description:
        "Check your PostgreSQL database connection details (Host, DB Name, etc.) and create a read-only user.",
      steps: [
        {
          title: "Create Read-Only User",
          paragraphs: [
            "For database security, we recommend creating a OneQuery-specific read-only user.",
            "Run the following SQL commands to create the user and grant permissions.",
          ],
          code: `-- Create User
CREATE USER onequery_readonly WITH PASSWORD 'secure_password';

-- Grant Read Permissions
GRANT CONNECT ON DATABASE your_database TO onequery_readonly;
GRANT USAGE ON SCHEMA public TO onequery_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onequery_readonly;

-- Automatically grant permissions on future tables (Optional)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO onequery_readonly;`,
          imageSrc: "/images/postgresql/step1_create_user.png",
          imageAlt: "PostgreSQL Create User SQL",
        },
        {
          title: "Check Connection Details",
          paragraphs: ["Please prepare the following information:"],
          bullets: [
            "Host: Database Address (e.g., db.example.com)",
            "Port: Default is 5432.",
            "Database Name: Name of the database to connect to",
            "Username: onequery_readonly",
            "Password: The password you set",
          ],
          imageSrc: "/images/postgresql/step2_connection.png",
          imageAlt: "PostgreSQL Connection Form",
          reverse: true,
        },
      ],
    },
  },
  supabase: {
    providerLabel: "Supabase",
    ko: {
      title: "Supabase 연동 가이드",
      description:
        "Supabase는 내부적으로 PostgreSQL이므로 Project Settings에서 연결 정보와 Database password를 확인한 뒤 읽기 전용 계정 또는 전용 접속 정보를 사용해 연결해 주세요.",
      steps: [
        {
          title: "Connection string 확인",
          paragraphs: [
            "Supabase Dashboard에서 대상 프로젝트를 연 뒤 `Project Settings > Database`로 이동하세요.",
            "`Connection string` 또는 `Connection info` 섹션에서 Host, Port, Database, User 정보를 확인할 수 있습니다.",
          ],
        },
        {
          title: "Database password 준비",
          paragraphs: [
            "Supabase는 데이터베이스 비밀번호가 필요합니다. 프로젝트 생성 시 설정한 Database password를 준비하세요.",
            "비밀번호를 잊어버렸다면 Supabase Dashboard에서 데이터베이스 비밀번호를 재설정한 뒤 새 값을 사용하세요.",
          ],
          reverse: true,
        },
        {
          title: "가급적 읽기 전용 계정 사용",
          paragraphs: [
            "운영 환경이라면 Supabase 기본 관리자 계정보다 OneQuery 전용 읽기 계정을 만들어 사용하는 편이 안전합니다.",
            "Supabase SQL Editor에서 아래 예시처럼 읽기 전용 권한을 부여할 수 있습니다.",
          ],
          code: `CREATE USER onequery_readonly WITH PASSWORD 'secure_password';

GRANT CONNECT ON DATABASE postgres TO onequery_readonly;
GRANT USAGE ON SCHEMA public TO onequery_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onequery_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO onequery_readonly;`,
        },
        {
          title: "OneQuery에 입력",
          paragraphs: [
            "OneQuery에서는 Supabase를 선택한 뒤 Supabase connection string 또는 수동 입력 값을 그대로 넣으면 됩니다.",
            "Supabase는 SSL이 필요하므로 이 integration은 내부적으로 PostgreSQL + SSL required 설정으로 저장됩니다.",
          ],
          bullets: [
            "Host 예시: db.<project-ref>.supabase.co",
            "Port: 5432",
            "Database: postgres",
            "Username 예시: postgres.<project-ref> 또는 읽기 전용 사용자",
          ],
          reverse: true,
        },
      ],
      closingTitle: "연동 준비 완료!",
      closingDescription:
        "이제 Supabase 프로젝트의 Postgres 데이터를 OneQuery에서 직접 조회할 수 있습니다.",
    },
    en: {
      title: "Supabase Integration Guide",
      description:
        "Supabase is backed by PostgreSQL. Open the project database settings, collect the connection details and database password, then connect it in OneQuery.",
      steps: [
        {
          title: "Find the connection string",
          paragraphs: [
            "Open the target project in the Supabase Dashboard and go to `Project Settings > Database`.",
            "Use the `Connection string` or `Connection info` section to collect host, port, database, and username.",
          ],
        },
        {
          title: "Prepare the database password",
          paragraphs: [
            "Supabase requires the database password. Use the database password configured for the project.",
            "If you no longer have it, reset the database password in Supabase and use the new value.",
          ],
          reverse: true,
        },
        {
          title: "Prefer a read-only user",
          paragraphs: [
            "For production projects, using a OneQuery-specific read-only user is safer than reusing the default admin connection.",
            "You can create one from the Supabase SQL editor with the example below.",
          ],
          code: `CREATE USER onequery_readonly WITH PASSWORD 'secure_password';

GRANT CONNECT ON DATABASE postgres TO onequery_readonly;
GRANT USAGE ON SCHEMA public TO onequery_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onequery_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO onequery_readonly;`,
        },
        {
          title: "Enter it in OneQuery",
          paragraphs: [
            "Select Supabase in OneQuery, then paste the Supabase connection string or fill the connection details manually.",
            "This integration is stored internally as PostgreSQL with SSL required, so the runtime path stays identical to Postgres.",
          ],
          bullets: [
            "Host example: db.<project-ref>.supabase.co",
            "Port: 5432",
            "Database: postgres",
            "Username example: postgres.<project-ref> or your read-only user",
          ],
          reverse: true,
        },
      ],
      closingTitle: "Integration Ready!",
      closingDescription:
        "You can now query your Supabase Postgres data directly from OneQuery.",
    },
  },
  posthog: {
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
  },
  // Live Sentry UI currently exposes this flow under Personal Tokens, and the
  // permission preview shows event:read rather than a separate issue scope.
  sentry: {
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
  },
};

interface GuideSectionProps {
  step: GuideStep;
  index: number;
}

function GuideSection(props: GuideSectionProps) {
  const hasImage = Boolean(props.step.imageSrc);
  const layoutClassName = hasImage
    ? "grid gap-5 rounded-xl border p-4 md:grid-cols-2"
    : "rounded-xl border p-4";
  const textClassName = props.step.reverse ? "md:order-2" : "";
  const imageClassName = props.step.reverse ? "md:order-1" : "";
  const renderedCode = props.step.code?.replaceAll(
    CONNECTOR_BASE_URL_TOKEN,
    `${getBrowserOrigin()}${APP_API_PATH}`
  );

  return (
    <section className={layoutClassName}>
      <div className={textClassName}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Step {props.index + 1}
        </p>
        <h3 className="mb-3 text-lg font-semibold">{props.step.title}</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          {props.step.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {props.step.bullets && props.step.bullets.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {props.step.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        )}
        {renderedCode && (
          <pre className="mt-3 overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-relaxed">
            {renderedCode}
          </pre>
        )}
        {props.step.note && (
          <p className="mt-3 rounded-md border bg-muted/60 p-2 text-xs text-muted-foreground">
            {props.step.note}
          </p>
        )}
      </div>
      {hasImage && props.step.imageSrc && props.step.imageAlt && (
        <div className={imageClassName}>
          <img
            src={props.step.imageSrc}
            alt={props.step.imageAlt}
            className="h-auto max-h-[400px] w-full rounded-lg border object-contain"
          />
        </div>
      )}
    </section>
  );
}

function GuideLocaleView(props: {
  content?: GuideLocaleContent;
  providerLabel: string;
}) {
  if (!props.content) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        <p>
          {props.providerLabel} 가이드는 아직 wb-landing 원문 페이지가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border p-4">
        <h2 className="text-lg font-semibold">{props.content.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {props.content.description}
        </p>
      </section>

      {props.content.steps.map((step, index) => (
        <GuideSection key={step.title} step={step} index={index} />
      ))}

      {props.content.closingTitle && (
        <section className="rounded-xl border p-4">
          <h3 className="text-base font-semibold">
            {props.content.closingTitle}
          </h3>
          {props.content.closingDescription && (
            <p className="mt-2 text-sm text-muted-foreground">
              {props.content.closingDescription}
            </p>
          )}
          {props.content.closingNote && (
            <p className="mt-2 rounded-md border bg-muted/60 p-2 text-xs text-muted-foreground">
              {props.content.closingNote}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

interface DataSourceConnectionGuideDialogProps {
  provider: ProviderType;
}

export function DataSourceConnectionGuideDialog(
  props: DataSourceConnectionGuideDialogProps
) {
  const [open, setOpen] = useState(false);
  const guide = GUIDE_CONTENT[props.provider];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            How to connect
          </Button>
        }
      />
      <DialogContent
        overlayClassName="bg-black/35 supports-backdrop-filter:backdrop-blur-lg"
        className="h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden gap-0 p-0 sm:max-w-[96vw]"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>{guide.providerLabel} Connection Guide</DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue="en"
          className="flex h-full min-h-0 flex-col overflow-hidden px-5 pb-5"
        >
          <TabsList className="mt-4 w-full max-w-[320px]">
            <TabsTrigger value="en" className="flex-1">
              English
            </TabsTrigger>
            <TabsTrigger value="ko" className="flex-1">
              한국어
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="en"
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <GuideLocaleView
              content={guide.en}
              providerLabel={guide.providerLabel}
            />
          </TabsContent>

          <TabsContent
            value="ko"
            className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <GuideLocaleView
              content={guide.ko}
              providerLabel={guide.providerLabel}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
