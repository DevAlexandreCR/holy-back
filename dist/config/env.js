"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const requiredKeys = ['DATABASE_URL', 'JWT_SECRET', 'BIBLE_API_BASE_URL'];
const readEnv = (key, defaultValue) => {
    const value = process.env[key] ?? defaultValue;
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};
const toNumber = (value, key) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${key} must be a number`);
    }
    return parsed;
};
const ensureRequired = () => {
    requiredKeys.forEach((key) => {
        if (!process.env[key]) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
    });
};
ensureRequired();
const APP_PORT = toNumber(readEnv('PORT', '3000'), 'PORT');
const JWT_SECRET = readEnv('JWT_SECRET');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? JWT_SECRET;
exports.config = {
    app: {
        port: APP_PORT,
    },
    db: {
        url: readEnv('DATABASE_URL'),
    },
    auth: {
        jwtSecret: JWT_SECRET,
        jwtRefreshSecret: JWT_REFRESH_SECRET,
    },
    external: {
        bibleApiBaseUrl: readEnv('BIBLE_API_BASE_URL'),
    },
};
//# sourceMappingURL=env.js.map