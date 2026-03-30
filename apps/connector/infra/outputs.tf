output "athena_database" {
	description = "Glue/Athena database name configured for connector queries."
	value       = aws_glue_catalog_database.connector.name
}

output "athena_workgroup" {
	description = "Athena workgroup used by the connector."
	value       = aws_athena_workgroup.connector.name
}

output "athena_output_location" {
	description = "S3 output location for Athena query results."
	value       = local.athena_output_location
}

output "enrollment_token_parameter_name" {
	description = "SSM parameter name holding connector enrollment token."
	value       = local.enrollment_token_parameter_name
}

output "ecr_repository_url" {
	description = "ECR repository URL for connector image push."
	value       = var.create_ecr_repository ? aws_ecr_repository.connector[0].repository_url : null
}

output "connector_image_uri_default" {
	description = "Default image URI used by EC2 helper scripts."
	value       = local.connector_image_uri
}

output "sample_table_name" {
	description = "Athena table name for connector smoke test."
	value       = var.create_sample_dataset ? var.sample_table_name : null
}

output "sample_table_setup_named_query_id" {
	description = "Athena named query ID that creates the sample table (run it once in Athena console/CLI)."
	value       = var.create_sample_dataset ? aws_athena_named_query.sample_table_setup[0].id : null
}

output "ec2_instance_id" {
	description = "Connector EC2 instance ID (if create_ec2_host=true)."
	value       = var.create_ec2_host ? aws_instance.connector[0].id : null
}

output "ec2_public_ip" {
	description = "Public IP of connector EC2 instance (if create_ec2_host=true)."
	value       = var.create_ec2_host ? aws_instance.connector[0].public_ip : null
}

output "ec2_ssm_start_session_command" {
	description = "Command to open an SSM shell on the connector host."
	value = var.create_ec2_host ? "aws ssm start-session --target ${aws_instance.connector[0].id} --region ${var.aws_region}" : null
}

output "connector_env_preview" {
	description = "Rendered connector env shape (token fetched from SSM by helper script)."
	sensitive   = true
	value = <<-EOT
		ONEQUERY_BASE_URL=${var.onequery_base_url}
		ONEQUERY_ENROLLMENT_TOKEN=<loaded at runtime from ${local.enrollment_token_parameter_name}>
		ORGANIZATION_ID=${var.organization_id}
		CONNECTOR_NAME=${var.connector_name}
		AWS_REGION=${var.aws_region}
		ATHENA_DATABASE=${aws_glue_catalog_database.connector.name}
		ATHENA_WORKGROUP=${aws_athena_workgroup.connector.name}
		ATHENA_OUTPUT_LOCATION=${local.athena_output_location}
		POLL_INTERVAL_MS=3000
		HEARTBEAT_INTERVAL_MS=15000
		QUERY_TIMEOUT_MS=60000
		MAX_ROWS=1000
		MAX_PAYLOAD_BYTES=5242880
	EOT
}
