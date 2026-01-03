import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { config } from '../../config/env';
import {
  forgotPassword,
  getUserWithSettings,
  loginUser,
  registerUser,
  resetPassword,
} from './auth.service';

const registerSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z
  .object({
    token: z.string().min(1, 'Token is required'),
    new_password: z.string().min(8, 'Password must be at least 8 characters').optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  })
  .refine((value) => value.new_password || value.password, {
    message: 'Password is required',
    path: ['new_password'],
  });

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload);
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error);
  }
};

export const register = async (req: Request, res: Response) => {
  const body = parseOrThrow(registerSchema, req.body);
  const result = await registerUser({
    name: body.name,
    email: body.email.toLowerCase(),
    password: body.password,
  });

  res.status(201).json({ data: result });
};

export const login = async (req: Request, res: Response) => {
  const body = parseOrThrow(loginSchema, req.body);
  const result = await loginUser({
    email: body.email.toLowerCase(),
    password: body.password,
  });

  res.json({ data: result });
};

export const forgot = async (req: Request, res: Response) => {
  const body = parseOrThrow(forgotSchema, req.body);
  const result = await forgotPassword(body.email.toLowerCase());
  res.json({ data: result });
};

export const reset = async (req: Request, res: Response) => {
  const body = parseOrThrow(resetSchema, req.body);
  await resetPassword({
    token: body.token,
    newPassword: body.new_password ?? body.password ?? '',
  });
  res.json({ data: { message: 'Password updated successfully' } });
};

export const resetRedirect = async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(400).send('Missing token');
    return;
  }

  let deepLinkUrl = '';
  try {
    const deepLinkBase = config.mail.passwordResetDeepLink;
    const url = new URL(deepLinkBase);
    url.searchParams.set('token', token);
    deepLinkUrl = url.toString();
  } catch (error) {
    throw new AppError('Invalid reset deeplink configuration', 'RESET_URL_INVALID', 500, error);
  }

  const escapedLink = deepLinkUrl.replace(/"/g, '&quot;');
  const html = `
<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Restablecer contraseña</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 28px; max-width: 480px; width: 94%; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 12px; font-size: 22px; color: #f8fafc; }
    p { margin: 0 0 14px; line-height: 1.5; color: #cbd5e1; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 700; margin: 12px 0; }
    .note { font-size: 14px; color: #94a3b8; }
    .link-copy { word-break: break-all; background: #0b1220; border: 1px solid #1f2937; padding: 12px; border-radius: 10px; color: #e2e8f0; font-size: 13px; }
    .fallback { display: none; margin-top: 18px; }
    .fallback.visible { display: block; }
    .cta { margin-top: 10px; display: inline-block; color: #a5b4fc; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Restablecer contraseña</h1>
    <p>Te estamos redirigiendo a la app para completar el cambio.</p>
    <a class="btn" id="open-app" href="${escapedLink}">Abrir HolyVerso</a>
    <p class="note">Si no se abre automáticamente, toca el botón o copia este enlace:</p>
    <div class="link-copy">${escapedLink}</div>
    <div id="fallback" class="fallback">
      <p class="note">¿No tienes la app instalada?</p>
      <a class="cta" href="https://holyverso.com/#download">Descargar HolyVerso</a>
    </div>
  </div>
  <script>
    (function () {
      const appLink = "${escapedLink}";
      const fallback = document.getElementById("fallback");
      const openButton = document.getElementById("open-app");

      const openApp = () => {
        window.location.replace(appLink);
        setTimeout(() => {
          if (fallback) fallback.classList.add("visible");
        }, 1200);
      };

      openButton?.addEventListener("click", (event) => {
        event.preventDefault();
        openApp();
      });

      openApp();
    })();
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
};

export const me = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401);
  }

  const profile = await getUserWithSettings(req.user.sub);
  res.json({ data: profile });
};
