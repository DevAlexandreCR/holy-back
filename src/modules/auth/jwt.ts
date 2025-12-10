import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { config } from '../../config/env';

export type AuthTokenPayload = {
  sub: string;
  email: string;
};

type TokenType = 'access' | 'refresh';

const signToken = (payload: AuthTokenPayload, type: TokenType): string => {
  const secret = type === 'access' ? config.auth.jwtSecret : config.auth.jwtRefreshSecret;
  const expiresIn = type === 'access' ? config.auth.accessTokenTtl : config.auth.refreshTokenTtl;
  const options: SignOptions = { expiresIn };
  return jwt.sign(payload, secret, options);
};

const verifyToken = (token: string, type: TokenType): AuthTokenPayload => {
  const secret = type === 'access' ? config.auth.jwtSecret : config.auth.jwtRefreshSecret;
  const decoded = jwt.verify(token, secret) as JwtPayload;
  if (!decoded.sub || !decoded.email) {
    throw new Error('Invalid token payload');
  }
  return { sub: decoded.sub as string, email: decoded.email as string };
};

export const signAccessToken = (payload: AuthTokenPayload): string => signToken(payload, 'access');

export const signRefreshToken = (payload: AuthTokenPayload): string => signToken(payload, 'refresh');

export const verifyAccessToken = (token: string): AuthTokenPayload => verifyToken(token, 'access');
