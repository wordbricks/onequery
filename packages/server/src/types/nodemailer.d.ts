declare module "nodemailer" {
  export function createTransport(options: unknown): {
    sendMail(message: unknown): Promise<unknown>;
  };
}
