import type { GuideContent } from "./types";

export const mysqlGuideContent = {
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
} satisfies GuideContent;
