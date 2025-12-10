import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors';
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

const resetSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
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
    newPassword: body.new_password,
  });
  res.json({ data: { message: 'Password updated successfully' } });
};

export const me = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 'AUTH_REQUIRED', 401);
  }

  const profile = await getUserWithSettings(req.user.sub);
  res.json({ data: profile });
};
