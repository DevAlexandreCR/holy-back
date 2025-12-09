import { PrismaClient } from '@prisma/client';
declare const prisma: PrismaClient<{
    datasourceUrl: string;
    log: ("error" | "warn")[];
}, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare const connectToDatabase: () => Promise<void>;
export declare const disconnectFromDatabase: () => Promise<void>;
export { prisma };
//# sourceMappingURL=db.d.ts.map