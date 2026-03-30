variable "aws_region" {
	description = "AWS region for the connector test environment."
	type        = string
	default     = "ap-northeast-2"
}

variable "name_prefix" {
	description = "Prefix for resource names."
	type        = string
	default     = "onequery-connector"
}

variable "environment" {
	description = "Environment name suffix (for naming and tags)."
	type        = string
	default     = "test"
}

variable "tags" {
	description = "Additional tags to apply to resources."
	type        = map(string)
	default     = {}
}

variable "organization_id" {
	description = "OneQuery organization ID this connector should register under."
	type        = string
}

variable "connector_name" {
	description = "Connector display name used during registration."
	type        = string
	default     = "aws-athena-connector-test"
}

variable "onequery_base_url" {
	description = "OneQuery API base URL (without trailing slash required)."
	type        = string
	default     = "https://your-onequery-host.example/api"
}

variable "connector_enrollment_token" {
	description = "Enrollment token required by OneQuery /api/connectors/register."
	type        = string
	sensitive   = true

	validation {
		condition     = length(var.connector_enrollment_token) >= 24
		error_message = "connector_enrollment_token must be at least 24 characters."
	}
}

variable "athena_database" {
	description = "Glue/Athena database name used by the connector."
	type        = string
	default     = "onequery_connector_test"

	validation {
		condition = can(regex("^[a-z0-9_]+$", var.athena_database))
		error_message = "athena_database must contain only lowercase letters, numbers, and underscores."
	}
}

variable "athena_workgroup" {
	description = "Athena workgroup name used by the connector."
	type        = string
	default     = "onequery_connector_test"
}

variable "athena_results_prefix" {
	description = "S3 key prefix for Athena result objects."
	type        = string
	default     = "onequery"
}

variable "create_sample_dataset" {
	description = "Upload a tiny CSV dataset and create an Athena named query for smoke testing."
	type        = bool
	default     = true
}

variable "sample_table_name" {
	description = "Athena table name used for smoke test dataset."
	type        = string
	default     = "connector_smoke_test"
}

variable "results_bucket_force_destroy" {
	description = "Allow Terraform destroy to delete non-empty Athena results bucket."
	type        = bool
	default     = true
}

variable "create_ecr_repository" {
	description = "Create ECR repository to store connector image."
	type        = bool
	default     = true
}

variable "ecr_repository_name" {
	description = "Custom ECR repository name. Null uses an auto-generated name."
	type        = string
	default     = null
}

variable "ecr_force_delete" {
	description = "Allow Terraform destroy to remove ECR repository with images."
	type        = bool
	default     = true
}

variable "ecr_keep_image_count" {
	description = "How many recent images to keep in ECR."
	type        = number
	default     = 20

	validation {
		condition     = var.ecr_keep_image_count >= 1
		error_message = "ecr_keep_image_count must be at least 1."
	}
}

variable "connector_image_tag" {
	description = "Default image tag to run on EC2."
	type        = string
	default     = "latest"
}

variable "existing_ecr_image_uri" {
	description = "Optional image URI to run if create_ecr_repository is false."
	type        = string
	default     = null
}

variable "create_ec2_host" {
	description = "Create an EC2 host with Docker + helper scripts for the connector."
	type        = bool
	default     = true
}

variable "instance_type" {
	description = "EC2 instance type for connector host."
	type        = string
	default     = "t3.small"
}

variable "instance_root_volume_gb" {
	description = "Root EBS volume size for the connector host."
	type        = number
	default     = 30
}

variable "ec2_ami_id" {
	description = "Override AMI ID. Null selects latest Amazon Linux 2023 x86_64."
	type        = string
	default     = null
}

variable "vpc_id" {
	description = "VPC ID for connector host. Null uses default VPC."
	type        = string
	default     = null
}

variable "subnet_id" {
	description = "Subnet ID for connector host. Null picks first subnet in selected VPC."
	type        = string
	default     = null
}

variable "enable_ssh_ingress" {
	description = "Allow SSH ingress to connector EC2 host."
	type        = bool
	default     = false
}

variable "ssh_ingress_cidr_blocks" {
	description = "Allowed CIDRs for SSH when enable_ssh_ingress=true."
	type        = list(string)
	default     = []
}
