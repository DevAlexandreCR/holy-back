import express, { Request, Response } from 'express';
import path from 'path';
import authRouter from './modules/auth/auth.routes';
import analyticsRouter from './modules/analytics/analytics.routes';
import bibleRouter from './modules/bible/bible.routes';
import devotionalRouter from './modules/devotionals/devotional.routes';
import insightsRouter from './modules/insights/insights.routes';
import notificationRouter from './modules/notifications/notification.routes';
import rolesRouter from './modules/roles/roles.routes';
import shareAttributionRouter from './modules/shareAttribution/shareAttribution.routes';
import userRouter from './modules/user/user.routes';
import userProfileRouter from './modules/user/userProfile.routes';
import verseRouter from './modules/verse/verse.routes';
import widgetRouter from './modules/widget/widget.routes';
import { errorHandler } from './common/errorHandler';

export const app = express();

app.use(express.json({ limit: '250kb' }));
app.use('/storage', express.static(path.join(process.cwd(), 'storage')));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use(analyticsRouter);
app.use('/bible', bibleRouter);
app.use('/devotionals', devotionalRouter);
app.use(insightsRouter);
app.use(notificationRouter);
app.use('/roles', rolesRouter);
app.use(shareAttributionRouter);
app.use('/user', userRouter);
app.use('/users', userProfileRouter);
app.use('/verse', verseRouter);
app.use('/widget', widgetRouter);

app.use(errorHandler);
