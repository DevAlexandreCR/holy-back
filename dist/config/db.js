"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = exports.disconnectFromDatabase = exports.connectToDatabase = void 0;
const client_1 = require("@prisma/client");
const env_1 = require("./env");
const prisma = new client_1.PrismaClient({
    datasourceUrl: env_1.config.db.url,
    log: ['error', 'warn'],
});
exports.prisma = prisma;
const connectToDatabase = async () => {
    try {
        await prisma.$connect();
        // eslint-disable-next-line no-console
        console.log('Database connection established');
    }
    catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to connect to database', error);
        throw error;
    }
};
exports.connectToDatabase = connectToDatabase;
const disconnectFromDatabase = async () => {
    try {
        await prisma.$disconnect();
        // eslint-disable-next-line no-console
        console.log('Database connection closed');
    }
    catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error while disconnecting from database', error);
    }
};
exports.disconnectFromDatabase = disconnectFromDatabase;
//# sourceMappingURL=db.js.map