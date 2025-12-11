import { NextFunction, Request, Response } from 'express';
import { isAppError } from './errors';

export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error('[ErrorHandler]', {
    message: err.message,
    code: isAppError(err) ? err.code : 'INTERNAL_ERROR',
    stack: err.stack,
  });

  const status = isAppError(err) ? err.statusCode : 500;
  const code = isAppError(err) ? err.code : 'INTERNAL_ERROR';
  const message = isAppError(err) ? err.message : 'Internal Server Error';

  res.status(status).json({
    error: {
      message,
      code,
    },
  });
};
