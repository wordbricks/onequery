const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LEAD_CAPTURE_SOURCE = "onequery_landing";

export type ProductUpdatesFormInput = {
  email: string;
};

export type ContactFormInput = {
  email: string;
  message: string;
  name: string;
};

export type ProductUpdatesFormErrors = {
  email?: string;
};

export type ContactFormErrors = {
  email?: string;
  message?: string;
  name?: string;
};

type Validated<TValue, TErrors> =
  | { ok: true; value: TValue }
  | { ok: false; errors: TErrors };

export function validateProductUpdatesForm(
  input: ProductUpdatesFormInput
): Validated<ProductUpdatesFormInput, ProductUpdatesFormErrors> {
  const email = input.email.trim().toLowerCase();

  if (!EMAIL_ADDRESS_PATTERN.test(email)) {
    return {
      ok: false,
      errors: {
        email: "Please enter a valid email address",
      },
    };
  }

  return {
    ok: true,
    value: {
      email,
    },
  };
}

export function validateContactForm(
  input: ContactFormInput
): Validated<ContactFormInput, ContactFormErrors> {
  const email = input.email.trim().toLowerCase();
  const message = input.message.trim();
  const name = input.name.trim();
  const errors: ContactFormErrors = {};

  if (name.length < 1) {
    errors.name = "Please enter your name";
  } else if (name.length > 200) {
    errors.name = "Name must be 200 characters or fewer";
  }

  if (!EMAIL_ADDRESS_PATTERN.test(email)) {
    errors.email = "Please enter a valid email address";
  }

  if (message.length < 1) {
    errors.message = "Please enter a message";
  } else if (message.length > 4000) {
    errors.message = "Message must be 4000 characters or fewer";
  }

  if (errors.name || errors.email || errors.message) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      email,
      message,
      name,
    },
  };
}

export function getFirstLeadCaptureError(
  errors: ContactFormErrors | ProductUpdatesFormErrors
): string {
  if ("name" in errors && typeof errors.name === "string") {
    return errors.name;
  }

  if (typeof errors.email === "string") {
    return errors.email;
  }

  if ("message" in errors && typeof errors.message === "string") {
    return errors.message;
  }

  return "Request validation failed";
}
