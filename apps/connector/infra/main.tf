data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_vpc" "default" {
	count = var.create_ec2_host && var.vpc_id == null ? 1 : 0

	# Comment: many production AWS accounts disable the default VPC.
	# Set vpc_id/subnet_id explicitly when this lookup is unavailable.
	default = true
}

locals {
	stack_name                      = "${var.name_prefix}-${var.environment}"
	safe_stack_name                 = replace(lower(local.stack_name), "/[^a-z0-9-]/", "-")
	result_prefix                   = trimsuffix(var.athena_results_prefix, "/")
	selected_vpc_id                 = var.create_ec2_host ? coalesce(var.vpc_id, try(data.aws_vpc.default[0].id, null)) : null
	connector_ecr_repository_name   = coalesce(var.ecr_repository_name, "${local.safe_stack_name}/connector")
	enrollment_token_parameter_name = "/onequery/${var.environment}/connector/enrollment-token"
	common_tags = merge({
		Project     = "onequery-connector"
		Environment = var.environment
		ManagedBy   = "terraform"
	}, var.tags)
}

data "aws_subnets" "selected" {
	count = var.create_ec2_host && var.subnet_id == null && local.selected_vpc_id != null ? 1 : 0

	filter {
		name   = "vpc-id"
		values = [local.selected_vpc_id]
	}
}

data "aws_ami" "al2023" {
	count = var.create_ec2_host && var.ec2_ami_id == null ? 1 : 0

	owners      = ["amazon"]
	most_recent = true

	filter {
		name   = "name"
		values = ["al2023-ami-*-x86_64"]
	}

	filter {
		name   = "state"
		values = ["available"]
	}

	filter {
		name   = "virtualization-type"
		values = ["hvm"]
	}
}

locals {
	selected_subnet_id = var.create_ec2_host ? coalesce(var.subnet_id, try(data.aws_subnets.selected[0].ids[0], null)) : null
	ec2_ami_id         = var.create_ec2_host ? coalesce(var.ec2_ami_id, try(data.aws_ami.al2023[0].id, null)) : null
	connector_image_uri = coalesce(
		var.create_ecr_repository ? "${aws_ecr_repository.connector[0].repository_url}:${var.connector_image_tag}" : var.existing_ecr_image_uri,
		""
	)
}

resource "random_id" "bucket_suffix" {
	byte_length = 3
}

resource "aws_s3_bucket" "athena_results" {
	bucket = substr("${local.safe_stack_name}-${data.aws_caller_identity.current.account_id}-${random_id.bucket_suffix.hex}-athena-results", 0, 63)

	force_destroy = var.results_bucket_force_destroy

	tags = merge(local.common_tags, {
		Name = "${local.safe_stack_name}-athena-results"
	})
}

resource "aws_s3_bucket_versioning" "athena_results" {
	bucket = aws_s3_bucket.athena_results.id

	versioning_configuration {
		status = "Enabled"
	}
}

resource "aws_s3_bucket_server_side_encryption_configuration" "athena_results" {
	bucket = aws_s3_bucket.athena_results.id

	rule {
		apply_server_side_encryption_by_default {
			sse_algorithm = "AES256"
		}
	}
}

resource "aws_s3_bucket_public_access_block" "athena_results" {
	bucket = aws_s3_bucket.athena_results.id

	block_public_acls       = true
	block_public_policy     = true
	ignore_public_acls      = true
	restrict_public_buckets = true
}

locals {
	athena_output_location = "s3://${aws_s3_bucket.athena_results.bucket}/${local.result_prefix}/"
}

resource "aws_glue_catalog_database" "connector" {
	name = var.athena_database

	tags = local.common_tags
}

resource "aws_athena_workgroup" "connector" {
	name  = var.athena_workgroup
	state = "ENABLED"

	configuration {
		enforce_workgroup_configuration    = true
		publish_cloudwatch_metrics_enabled = true

		result_configuration {
			output_location = local.athena_output_location
		}
	}

	tags = local.common_tags
}

resource "aws_ssm_parameter" "connector_enrollment_token" {
	name        = local.enrollment_token_parameter_name
	description = "OneQuery connector enrollment token for ${local.safe_stack_name}"
	type        = "SecureString"
	value       = var.connector_enrollment_token

	tags = local.common_tags
}

resource "aws_s3_object" "sample_csv" {
	count = var.create_sample_dataset ? 1 : 0

	bucket       = aws_s3_bucket.athena_results.id
	key          = "${local.result_prefix}/sample-data/users.csv"
	content_type = "text/csv"
	content = <<-CSV
		id,name,created_at
		1,Alice,2026-01-01T00:00:00Z
		2,Bob,2026-01-02T00:00:00Z
		3,Chloe,2026-01-03T00:00:00Z
	CSV
}

resource "aws_athena_named_query" "sample_table_setup" {
	count = var.create_sample_dataset ? 1 : 0

	name      = "${local.safe_stack_name}-sample-table-setup"
	database  = aws_glue_catalog_database.connector.name
	workgroup = aws_athena_workgroup.connector.name
	query = <<-SQL
		CREATE EXTERNAL TABLE IF NOT EXISTS ${var.sample_table_name} (
		  id string,
		  name string,
		  created_at string
		)
		ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
		WITH SERDEPROPERTIES (
		  'separatorChar' = ',',
		  'quoteChar' = '"',
		  'escapeChar' = '\\\\'
		)
		STORED AS TEXTFILE
		LOCATION 's3://${aws_s3_bucket.athena_results.bucket}/${local.result_prefix}/sample-data/';
	SQL

	depends_on = [aws_s3_object.sample_csv]
}

data "aws_iam_policy_document" "connector_assume_role" {
	statement {
		sid     = "Ec2AssumeRole"
		effect  = "Allow"
		actions = ["sts:AssumeRole"]

		principals {
			type        = "Service"
			identifiers = ["ec2.amazonaws.com"]
		}
	}
}

resource "aws_iam_role" "connector_runtime" {
	name               = "${local.safe_stack_name}-runtime-role"
	assume_role_policy = data.aws_iam_policy_document.connector_assume_role.json

	tags = local.common_tags
}

resource "aws_iam_instance_profile" "connector_runtime" {
	name = "${local.safe_stack_name}-instance-profile"
	role = aws_iam_role.connector_runtime.name
}

data "aws_iam_policy_document" "connector_runtime" {
	statement {
		sid    = "AthenaStartQueryExecution"
		effect = "Allow"
		actions = [
			"athena:StartQueryExecution"
		]
		# Comment: Athena authorization for StartQueryExecution is evaluated against
		# the selected workgroup and auxiliary resources in ways that are brittle
		# under tight condition-based scoping. Keep the action wide here and rely on
		# the dedicated workgroup plus result bucket permissions below for isolation.
		resources = ["*"]
	}

	statement {
		sid    = "AthenaReadQueryExecution"
		effect = "Allow"
		actions = [
			"athena:GetQueryExecution",
			"athena:GetQueryResults",
			"athena:StopQueryExecution"
		]
		resources = ["*"]
	}

	statement {
		sid    = "AthenaWorkgroupRead"
		effect = "Allow"
		actions = [
			"athena:GetWorkGroup"
		]
		resources = [
			"arn:aws:athena:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:workgroup/${aws_athena_workgroup.connector.name}"
		]
	}

	statement {
		sid    = "GlueCatalogRead"
		effect = "Allow"
		actions = [
			"glue:GetDatabase",
			"glue:GetDatabases",
			"glue:GetTable",
			"glue:GetTables",
			"glue:GetPartitions"
		]
		resources = [
			"arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:catalog",
			"arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:database/${aws_glue_catalog_database.connector.name}",
			"arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.connector.name}/*"
		]
	}

	statement {
		sid    = "AthenaResultBucketList"
		effect = "Allow"
		actions = [
			"s3:ListBucket"
		]
		resources = [
			aws_s3_bucket.athena_results.arn
		]
		# Comment: Athena may issue ListBucket against internal prefixes that do not
		# match the explicit output prefix. Keep ListBucket scoped to the dedicated
		# results bucket rather than trying to over-constrain on s3:prefix.
	}

	statement {
		sid    = "AthenaResultBucketRead"
		effect = "Allow"
		actions = [
			"s3:GetObject"
		]
		resources = [
			"${aws_s3_bucket.athena_results.arn}/*"
		]
	}

	statement {
		sid    = "AthenaResultBucketWrite"
		effect = "Allow"
		actions = [
			"s3:PutObject",
			"s3:DeleteObject"
		]
		resources = [
			"${aws_s3_bucket.athena_results.arn}/${local.result_prefix}/*"
		]
	}

	statement {
		sid    = "AthenaResultBucketMetadata"
		effect = "Allow"
		actions = [
			"s3:GetBucketLocation"
		]
		resources = [aws_s3_bucket.athena_results.arn]
	}

	statement {
		sid    = "ReadEnrollmentTokenParameter"
		effect = "Allow"
		actions = [
			"ssm:GetParameter",
			"ssm:GetParameters"
		]
		resources = [aws_ssm_parameter.connector_enrollment_token.arn]
	}
}

resource "aws_iam_role_policy" "connector_runtime_inline" {
	name   = "${local.safe_stack_name}-runtime-inline"
	role   = aws_iam_role.connector_runtime.id
	policy = data.aws_iam_policy_document.connector_runtime.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
	role       = aws_iam_role.connector_runtime.name
	policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecr_read_only" {
	count = var.create_ec2_host ? 1 : 0

	role       = aws_iam_role.connector_runtime.name
	policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_ecr_repository" "connector" {
	count = var.create_ecr_repository ? 1 : 0

	name                 = local.connector_ecr_repository_name
	image_tag_mutability = "MUTABLE"
	force_delete         = var.ecr_force_delete

	image_scanning_configuration {
		scan_on_push = true
	}

	encryption_configuration {
		encryption_type = "AES256"
	}

	tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "connector" {
	count = var.create_ecr_repository ? 1 : 0

	repository = aws_ecr_repository.connector[0].name

	policy = jsonencode({
		rules = [
			{
				rulePriority = 1
				description  = "Keep recent connector images"
				selection = {
					tagStatus   = "any"
					countType   = "imageCountMoreThan"
					countNumber = var.ecr_keep_image_count
				}
				action = {
					type = "expire"
				}
			}
		]
	})
}

resource "aws_security_group" "connector" {
	count = var.create_ec2_host ? 1 : 0

	name_prefix = "${local.safe_stack_name}-sg-"
	description = "Connector host security group (egress only by default)"
	vpc_id      = local.selected_vpc_id

	egress {
		from_port   = 0
		to_port     = 0
		protocol    = "-1"
		cidr_blocks = ["0.0.0.0/0"]
	}

	dynamic "ingress" {
		for_each = var.enable_ssh_ingress ? [1] : []

		content {
			description = "SSH access for troubleshooting"
			from_port   = 22
			to_port     = 22
			protocol    = "tcp"
			cidr_blocks = var.ssh_ingress_cidr_blocks
		}
	}

	lifecycle {
		precondition {
			condition     = local.selected_vpc_id != null
			error_message = "No VPC resolved. Set vpc_id when create_ec2_host=true and no default VPC exists."
		}
	}

	tags = merge(local.common_tags, {
		Name = "${local.safe_stack_name}-sg"
	})
}

resource "aws_instance" "connector" {
	count = var.create_ec2_host ? 1 : 0

	ami                         = local.ec2_ami_id
	instance_type               = var.instance_type
	subnet_id                   = local.selected_subnet_id
	vpc_security_group_ids      = [aws_security_group.connector[0].id]
	iam_instance_profile        = aws_iam_instance_profile.connector_runtime.name
	associate_public_ip_address = true
	user_data_replace_on_change = true

	user_data = templatefile("${path.module}/templates/bootstrap.sh.tftpl", {
		aws_region                      = var.aws_region
		enrollment_token_parameter_name = local.enrollment_token_parameter_name
		onequery_base_url                  = var.onequery_base_url
		organization_id                 = var.organization_id
		connector_name                  = var.connector_name
		athena_database                 = aws_glue_catalog_database.connector.name
		athena_workgroup                = aws_athena_workgroup.connector.name
		athena_output_location          = local.athena_output_location
		connector_image_uri             = local.connector_image_uri
	})

	root_block_device {
		volume_size           = var.instance_root_volume_gb
		volume_type           = "gp3"
		encrypted             = true
		delete_on_termination = true
	}

	metadata_options {
		http_endpoint = "enabled"
		http_tokens   = "required"
	}

	lifecycle {
		precondition {
			condition     = local.selected_subnet_id != null
			error_message = "No subnet resolved. Set subnet_id when create_ec2_host=true and automatic subnet discovery fails."
		}
		precondition {
			condition     = local.ec2_ami_id != null
			error_message = "No AMI resolved. Set ec2_ami_id explicitly."
		}
	}

	tags = merge(local.common_tags, {
		Name = "${local.safe_stack_name}-host"
	})
}
