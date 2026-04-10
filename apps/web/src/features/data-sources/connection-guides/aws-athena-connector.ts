import type { GuideContent } from "./types";
import { CONNECTOR_BASE_URL_TOKEN } from "./types";

export const awsAthenaConnectorGuideContent = {
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
} satisfies GuideContent;
