import express, { NextFunction, Request, Response, Router } from 'express';
import authRouter from './modules/auth/auth.routes';
import { isAppError } from './common/errors';
import bibleRouter from './modules/bible/bible.routes';

export const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/bible', bibleRouter);
const placeholderRouter = (): Router => Router();
app.use('/user', placeholderRouter());
app.use('/verse', placeholderRouter());
app.use('/widget', placeholderRouter());

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = isAppError(err) ? err.statusCode : 500;
  const code = isAppError(err) ? err.code : 'INTERNAL_ERROR';
  const message = isAppError(err) ? err.message : 'Internal Server Error';

  res.status(status).json({
    error: {
      message,
      code,
    },
  });
});
