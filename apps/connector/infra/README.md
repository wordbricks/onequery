# AWS Test Environment (Terraform)

This stack creates a client-like AWS runtime for testing the OneQuery Athena connector.

## What It Provisions

- S3 bucket for Athena result output
- Glue catalog database
- Athena workgroup (enforced output location)
- Optional sample CSV + Athena named query for smoke test
- IAM role/profile for connector runtime (Athena/Glue/S3 + SSM read)
- SSM SecureString parameter for `CONNECTOR_ENROLLMENT_TOKEN`
- ECR repository for connector image (optional)
- EC2 host with Docker + helper scripts (optional)

## Prerequisites

- Terraform `>= 1.6`
- AWS credentials with permissions to create IAM/EC2/S3/Athena/Glue/SSM/ECR
- OneQuery `CONNECTOR_ENROLLMENT_TOKEN` value for the target environment

## Quick Start

```bash
cd apps/connector/infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars
terraform init
terraform apply
```

After apply, run the sample named query once to create the smoke-test table:

```bash
QUERY_ID="$(terraform output -raw sample_table_setup_named_query_id)"
AWS_REGION=ap-northeast-2
SQL="$(aws athena get-named-query --named-query-id "$QUERY_ID" --region "$AWS_REGION" --query 'NamedQuery.QueryString' --output text)"
aws athena start-query-execution \
  --query-string "$SQL" \
  --query-execution-context "Database=$(terraform output -raw athena_database)" \
  --work-group "$(terraform output -raw athena_workgroup)" \
  --result-configuration "OutputLocation=$(terraform output -raw athena_output_location)" \
  --region "$AWS_REGION"
```

## Build And Push Connector Image

```bash
ECR_URL="$(terraform output -raw ecr_repository_url)"
AWS_REGION=ap-northeast-2

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR_URL%/*}"

cd /path/to/onequery-repo
docker build -f apps/connector/Dockerfile -t "${ECR_URL}:latest" .
docker push "${ECR_URL}:latest"
```

## Start Connector On EC2 Host

```bash
INSTANCE_ID="$(terraform output -raw ec2_instance_id)"
AWS_REGION=ap-northeast-2
aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION"

# inside the instance shell
sudo /opt/onequery-connector/bin/start-connector.sh
sudo systemctl enable onequery-connector-docker.service
```

The bootstrap script writes `/opt/onequery-connector/.env` by reading enrollment token from SSM at runtime.

## Useful Outputs

- `athena_database`
- `athena_workgroup`
- `athena_output_location`
- `ecr_repository_url`
- `ec2_instance_id`
- `ec2_ssm_start_session_command`
- `connector_env_preview` (sensitive)
- `sample_table_name`
- `sample_table_setup_named_query_id`

## Notes

- If your account does not have a default VPC, set `vpc_id` and `subnet_id`.
- By default, EC2 has no inbound access. SSH is off unless `enable_ssh_ingress=true`.
- `connector_enrollment_token` is stored in Terraform state and SSM Parameter Store.
