export declare const config: {
    readonly app: {
        readonly port: number;
    };
    readonly db: {
        readonly url: string;
    };
    readonly auth: {
        readonly jwtSecret: string;
        readonly jwtRefreshSecret: string;
    };
    readonly external: {
        readonly bibleApiBaseUrl: string;
    };
};
export type AppConfig = typeof config;
//# sourceMappingURL=env.d.ts.map