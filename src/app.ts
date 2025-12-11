import express, { NextFunction, Request, Response } from 'express';
import authRouter from './modules/auth/auth.routes';
import { isAppError } from './common/errors';
import bibleRouter from './modules/bible/bible.routes';
import userRouter from './modules/user/user.routes';
import verseRouter from './modules/verse/verse.routes';
import widgetRouter from './modules/widget/widget.routes';

export const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/bible', bibleRouter);
app.use('/user', userRouter);
app.use('/verse', verseRouter);
app.use('/widget', widgetRouter);

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
