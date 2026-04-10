import type { GuideContent } from "./types";

export const supabaseGuideContent = {
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
} satisfies GuideContent;
