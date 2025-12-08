export declare const config: {
    readonly app: {
        readonly port: number;
    };
    readonly db: {
        readonly host: string;
        readonly port: number;
        readonly user: string;
        readonly password: string;
        readonly name: string;
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