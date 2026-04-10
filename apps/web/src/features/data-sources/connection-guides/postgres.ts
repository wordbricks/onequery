import type { GuideContent } from "./types";

export const postgresGuideContent = {
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
} satisfies GuideContent;
