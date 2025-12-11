import express, { Request, Response } from 'express';
import authRouter from './modules/auth/auth.routes';
import bibleRouter from './modules/bible/bible.routes';
import userRouter from './modules/user/user.routes';
import verseRouter from './modules/verse/verse.routes';
import widgetRouter from './modules/widget/widget.routes';
import { errorHandler } from './common/errorHandler';

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

app.use(errorHandler);
