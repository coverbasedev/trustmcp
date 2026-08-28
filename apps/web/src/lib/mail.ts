import "server-only";
import nodemailer from "nodemailer";

/**
 * Transactional email (access-request notifications, approval/deny notices).
 * No-ops with a log line when SMTP isn't configured, so dev/local still works.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean }> {
  const server = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM;
  if (!server || !from) {
    console.info(`[mail:skipped] to=${opts.to} subject="${opts.subject}" (SMTP not configured)`);
    return { sent: false };
  }
  const transport = nodemailer.createTransport(server);
  await transport.sendMail({ from, to: opts.to, subject: opts.subject, text: opts.text });
  return { sent: true };
}
