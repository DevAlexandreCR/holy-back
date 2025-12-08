import express, { NextFunction, Request, Response, Router } from 'express';

export const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

const placeholderRouter = (): Router => Router();

app.use('/auth', placeholderRouter());
app.use('/bible', placeholderRouter());
app.use('/user', placeholderRouter());
app.use('/verse', placeholderRouter());
app.use('/widget', placeholderRouter());

// Basic error handler to keep consistent error responses.
// Replace with a richer implementation when modules are added.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ message: 'Internal Server Error' });
});
