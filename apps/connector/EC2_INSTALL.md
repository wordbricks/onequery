# EC2 Install Guide (MVP)

1. Launch an EC2 instance and attach an IAM role with Athena/Glue/S3 permissions.
2. Ensure outbound HTTPS is available (NAT gateway or proxy).
3. Create `apps/connector/.env` with the real connector environment variables.
4. Build and run with Docker:

```bash
docker build -f apps/connector/Dockerfile -t onequery-connector .
docker run --env-file apps/connector/.env -d --name onequery-connector --restart always onequery-connector
```

5. Validate startup logs and confirm successful registration + heartbeat.

If using `systemd`, install `apps/connector/onequery-connector.service` and place the connector at `/opt/onequery-connector`.
