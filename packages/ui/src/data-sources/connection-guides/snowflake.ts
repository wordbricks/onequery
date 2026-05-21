import type { GuideContent } from "./types";

export const snowflakeGuideContent = {
  providerLabel: "Snowflake",
  ko: {
    title: "Snowflake 읽기 전용 계정 설정",
    description:
      "OneQuery가 Snowflake warehouse를 통해 승인된 데이터만 조회할 수 있도록 전용 role과 user를 준비합니다.",
    steps: [
      {
        title: "Role과 user 생성",
        paragraphs: [
          "Snowflake에서 SECURITYADMIN 또는 동등한 권한으로 전용 role과 user를 생성합니다.",
        ],
        code: `USE ROLE SECURITYADMIN;
CREATE ROLE IF NOT EXISTS ONEQUERY_READONLY;
CREATE USER IF NOT EXISTS ONEQUERY_READER
  PASSWORD = 'replace_with_strong_password'
  DEFAULT_ROLE = ONEQUERY_READONLY
  MUST_CHANGE_PASSWORD = FALSE;
GRANT ROLE ONEQUERY_READONLY TO USER ONEQUERY_READER;`,
      },
      {
        title: "Warehouse와 데이터 권한 부여",
        paragraphs: [
          "대상 warehouse, database, schema에 대한 사용 권한과 조회 권한을 부여합니다.",
        ],
        code: `GRANT USAGE ON WAREHOUSE ANALYTICS_WH TO ROLE ONEQUERY_READONLY;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEQUERY_READONLY;
GRANT USAGE ON SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON ALL TABLES IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON FUTURE TABLES IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON ALL VIEWS IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;`,
      },
      {
        title: "연결 정보 입력",
        paragraphs: [
          "Account identifier, warehouse, database, schema, role, username, password를 OneQuery에 입력합니다.",
        ],
        bullets: [
          "Account Identifier: xy12345.us-east-1",
          "Warehouse: ANALYTICS_WH",
          "Database: ANALYTICS",
          "Schema: PUBLIC",
          "Role: ONEQUERY_READONLY",
        ],
      },
    ],
    closingTitle: "설정이 완료되었습니다.",
    closingDescription:
      "이제 OneQuery에서 Snowflake SELECT 쿼리를 실행할 수 있습니다.",
  },
  en: {
    title: "Snowflake Read-Only Account Guide",
    description:
      "Create a dedicated role and user so OneQuery can query approved Snowflake data through a warehouse.",
    steps: [
      {
        title: "Create a role and user",
        paragraphs: [
          "In Snowflake, use SECURITYADMIN or an equivalent role to create a dedicated role and user.",
        ],
        code: `USE ROLE SECURITYADMIN;
CREATE ROLE IF NOT EXISTS ONEQUERY_READONLY;
CREATE USER IF NOT EXISTS ONEQUERY_READER
  PASSWORD = 'replace_with_strong_password'
  DEFAULT_ROLE = ONEQUERY_READONLY
  MUST_CHANGE_PASSWORD = FALSE;
GRANT ROLE ONEQUERY_READONLY TO USER ONEQUERY_READER;`,
      },
      {
        title: "Grant warehouse and data access",
        paragraphs: [
          "Grant usage on the target warehouse, database, and schema, then grant read access to the tables and views OneQuery should query.",
        ],
        code: `GRANT USAGE ON WAREHOUSE ANALYTICS_WH TO ROLE ONEQUERY_READONLY;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEQUERY_READONLY;
GRANT USAGE ON SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON ALL TABLES IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON FUTURE TABLES IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON ALL VIEWS IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;
GRANT SELECT ON FUTURE VIEWS IN SCHEMA ANALYTICS.PUBLIC TO ROLE ONEQUERY_READONLY;`,
      },
      {
        title: "Enter connection details",
        paragraphs: [
          "Enter the account identifier, warehouse, database, schema, role, username, and password in OneQuery.",
        ],
        bullets: [
          "Account Identifier: xy12345.us-east-1",
          "Warehouse: ANALYTICS_WH",
          "Database: ANALYTICS",
          "Schema: PUBLIC",
          "Role: ONEQUERY_READONLY",
        ],
      },
    ],
    closingTitle: "Setup complete.",
    closingDescription:
      "OneQuery can now run SELECT queries against Snowflake.",
  },
} satisfies GuideContent;
