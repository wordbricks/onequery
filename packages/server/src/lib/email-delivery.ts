export type EmailDeliveryMode = "manual-link" | "smtp";

export type SmtpConfig = {
  fromEmail: string;
  fromName?: string;
  host: string;
  password?: string;
  port: number;
  secure: boolean;
  username?: string;
};

export type AuthEmailDeliveryConfig = {
  baseURL?: string;
  smtp?: SmtpConfig;
};

export type InvitationDeliveryInput = {
  email: string;
  id: string;
  inviter: {
    email: string;
    name: string;
  };
  organization: {
    id: string;
    name: string;
  };
  role: string;
};

export type PasswordResetDeliveryInput = {
  token: string;
  url: string;
  user: {
    email: string;
    name: string;
  };
};

export type DeliveryResult = {
  mode: EmailDeliveryMode;
  url: string;
};

export function getEmailDeliveryMode(
  config: AuthEmailDeliveryConfig | undefined
): EmailDeliveryMode {
  return config?.smtp ? "smtp" : "manual-link";
}

export function buildInvitationUrl(
  baseURL: string,
  invitationId: string
): string {
  return new URL(`/invite/${invitationId}`, baseURL).toString();
}

export async function deliverInvitationEmail(
  config: AuthEmailDeliveryConfig | undefined,
  input: InvitationDeliveryInput,
  request?: Request
): Promise<DeliveryResult> {
  const baseURL = resolveBaseURL(config, request);
  const inviteUrl = buildInvitationUrl(baseURL, input.id);
  const mode = getEmailDeliveryMode(config);

  if (!config?.smtp) {
    console.info("[auth] invitation manual link", {
      email: input.email,
      invitationId: input.id,
      inviteUrl,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      role: input.role,
    });

    return {
      mode,
      url: inviteUrl,
    };
  }

  const inviterName =
    input.inviter.name.trim().length > 0
      ? input.inviter.name
      : input.inviter.email;
  await sendSmtpMessage(config.smtp, {
    html: [
      `<p>${escapeHtml(inviterName)} invited you to join ${escapeHtml(
        input.organization.name
      )} in OneQuery.</p>`,
      `<p>Role: ${escapeHtml(input.role)}</p>`,
      `<p><a href="${escapeHtml(inviteUrl)}">Accept invitation</a></p>`,
    ].join(""),
    subject: `Join ${input.organization.name} on OneQuery`,
    text: [
      `${inviterName} invited you to join ${input.organization.name} in OneQuery.`,
      `Role: ${input.role}`,
      `Accept invitation: ${inviteUrl}`,
    ].join("\n"),
    to: input.email,
  });

  return {
    mode,
    url: inviteUrl,
  };
}

export async function deliverPasswordResetEmail(
  config: AuthEmailDeliveryConfig | undefined,
  input: PasswordResetDeliveryInput,
  request?: Request
): Promise<DeliveryResult> {
  const baseURL = resolveBaseURL(config, request);
  const url = new URL(input.url, baseURL).toString();
  const mode = getEmailDeliveryMode(config);

  if (!config?.smtp) {
    console.info("[auth] password reset manual link", {
      email: input.user.email,
      resetUrl: url,
      token: input.token,
    });

    return {
      mode,
      url,
    };
  }

  const displayName =
    input.user.name.trim().length > 0 ? input.user.name : input.user.email;
  await sendSmtpMessage(config.smtp, {
    html: [
      `<p>${escapeHtml(displayName)},</p>`,
      "<p>Use the link below to reset your OneQuery password.</p>",
      `<p><a href="${escapeHtml(url)}">Reset password</a></p>`,
    ].join(""),
    subject: "Reset your OneQuery password",
    text: [
      `${displayName},`,
      "Use the link below to reset your OneQuery password.",
      url,
    ].join("\n"),
    to: input.user.email,
  });

  return {
    mode,
    url,
  };
}

function resolveBaseURL(
  config: AuthEmailDeliveryConfig | undefined,
  request?: Request
): string {
  if (config?.baseURL) {
    return config.baseURL;
  }

  if (request) {
    return new URL(request.url).origin;
  }

  return "http://127.0.0.1:4545";
}

async function sendSmtpMessage(
  config: SmtpConfig,
  input: {
    html: string;
    subject: string;
    text: string;
    to: string;
  }
): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    auth:
      config.username || config.password
        ? {
            pass: config.password,
            user: config.username,
          }
        : undefined,
    host: config.host,
    port: config.port,
    secure: config.secure,
  });

  await transporter.sendMail({
    from: config.fromName
      ? `"${config.fromName}" <${config.fromEmail}>`
      : config.fromEmail,
    html: input.html,
    subject: input.subject,
    text: input.text,
    to: input.to,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
