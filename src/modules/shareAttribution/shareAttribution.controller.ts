import { Request, Response } from 'express'
import { z } from 'zod'
import { AppError } from '../../common/errors'
import {
  getShareRedirectContext,
  recordShareAttributionAppOpen,
} from './shareAttribution.service'

const appOpenSchema = z.object({
  token: z.string().min(1),
  device_id: z.string().min(1).optional().nullable(),
  install_detected: z.boolean().optional(),
  registration_completed: z.boolean().optional(),
})

const parseOrThrow = <T>(schema: z.Schema<T>, payload: unknown): T => {
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new AppError('Validation failed', 'VALIDATION_ERROR', 400, error)
  }
}

const buildRedirectHtml = (params: {
  devotionalTitle: string
  appLink: string
  universalLink: string
  isAvailable: boolean
}) => {
  if (!params.isAvailable) {
    return `
<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Devocional no disponible</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { width: min(92vw, 480px); background: #111827; border-radius: 18px; padding: 28px; border: 1px solid #1f2937; }
    h1 { margin: 0 0 12px; color: #f8fafc; }
    p { margin: 0 0 12px; line-height: 1.5; color: #cbd5e1; }
    a { color: #fbbf24; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Este devocional no está disponible</h1>
    <p>El contenido fue retirado de la vista pública o ya no se puede abrir.</p>
    <a href="https://holyverso.com/#download">Abrir HolyVerso</a>
  </div>
</body>
</html>
    `
  }

  const escapedTitle = params.devotionalTitle.replace(/"/g, '&quot;')
  return `
<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { width: min(92vw, 520px); background: #111827; border-radius: 18px; padding: 28px; border: 1px solid #1f2937; box-shadow: 0 18px 60px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 10px; color: #f8fafc; font-size: 24px; }
    p { margin: 0 0 12px; line-height: 1.5; color: #cbd5e1; }
    .btn { display: inline-flex; align-items: center; justify-content: center; margin-top: 12px; padding: 12px 16px; border-radius: 12px; background: #fbbf24; color: #0f172a; text-decoration: none; font-weight: 800; }
    .subtle { color: #94a3b8; font-size: 14px; }
    .fallback { margin-top: 18px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapedTitle}</h1>
    <p>Estamos abriendo este devocional en HolyVerso.</p>
    <a class="btn" href="${params.universalLink}" id="open-link">Abrir en la app</a>
    <p class="subtle fallback">Si no se abre automáticamente, toca el botón o instala la app.</p>
    <a class="subtle" href="https://holyverso.com/#download">Descargar HolyVerso</a>
  </div>
  <script>
    (function () {
      const appLink = ${JSON.stringify(params.appLink)};
      const universalLink = ${JSON.stringify(params.universalLink)};
      window.location.replace(appLink);
      setTimeout(() => {
        window.location.replace(universalLink);
      }, 900);
    })();
  </script>
</body>
</html>
  `
}

export const shareRedirectHandler = async (req: Request, res: Response) => {
  const context = await getShareRedirectContext(req.params.token)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(
    buildRedirectHtml({
      devotionalTitle: context.devotionalTitle,
      appLink: context.appLink,
      universalLink: context.universalLink,
      isAvailable: context.isAvailable,
    })
  )
}

export const shareAttributionAppOpenHandler = async (
  req: Request,
  res: Response
) => {
  const body = parseOrThrow(appOpenSchema, req.body)
  const result = await recordShareAttributionAppOpen({
    token: body.token,
    deviceId: body.device_id ?? null,
    userId: req.user?.sub,
    installDetected: body.install_detected,
    registrationCompleted: body.registration_completed,
  })

  res.json({ data: result })
}
