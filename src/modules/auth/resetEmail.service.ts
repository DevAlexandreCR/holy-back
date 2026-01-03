import nodemailer from 'nodemailer';
import { AppError } from '../../common/errors';
import { config } from '../../config/env';

let transporter: nodemailer.Transporter | null = null;

const buildTransporter = (): nodemailer.Transporter => {
  const { host, port, secure, user, password, from, isConfigured } = config.mail;

  if (!isConfigured || !host || !port || !from) {
    throw new AppError(
      'Email service is not configured correctly',
      'MAILER_NOT_CONFIGURED',
      500,
    );
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && password ? { user, pass: password } : undefined,
    });
  }

  return transporter;
};

const buildResetUrl = (token: string): string => {
  const baseUrl = config.mail.passwordResetBaseUrl;
  if (!baseUrl) {
    throw new AppError(
      'PASSWORD_RESET_BASE_URL is not configured',
      'RESET_URL_NOT_CONFIGURED',
      500,
    );
  }

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  } catch (error) {
    throw new AppError('Invalid PASSWORD_RESET_BASE_URL', 'RESET_URL_INVALID', 500, error);
  }
};

export const sendResetPasswordEmail = async (email: string, token: string): Promise<void> => {
  const resetUrl = buildResetUrl(token);
  const mailer = buildTransporter();

  const expiresMinutes = config.auth.resetTokenTtlMinutes;

  await mailer.sendMail({
    from: config.mail.from,
    to: email,
    subject: 'Restablece tu contraseña',
    text: [
      'Recibimos una solicitud para restablecer tu contraseña.',
      '',
      `Abre este enlace para continuar: ${resetUrl}`,
      '',
      `El enlace expira en ${expiresMinutes} minutos.`,
      'Si no solicitaste este cambio, ignora este correo.',
    ].join('\n'),
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:12px 16px;border-radius:8px;text-decoration:none;display:inline-block;">Restablecer contraseña</a></p>
      <p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>El enlace expira en ${expiresMinutes} minutos.</p>
      <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
    `,
  });
};
