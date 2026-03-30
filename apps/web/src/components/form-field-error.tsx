import { FieldError } from "@onequery/ui/components/field";

interface FormFieldErrorProps {
  message?: string | null;
  className?: string;
}

export function FormFieldError({ message, className }: FormFieldErrorProps) {
  if (!message) {
    return null;
  }

  return <FieldError className={className}>{message}</FieldError>;
}
