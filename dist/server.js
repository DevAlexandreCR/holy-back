"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const { port } = env_1.config.app;
let server;
const start = async () => {
    try {
        await (0, db_1.connectToDatabase)();
        server = app_1.app.listen(port, () => {
            // eslint-disable-next-line no-console
            console.log(`Backend running on port ${port}`);
        });
    }
    catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to start server', error);
        process.exit(1);
    }
};
const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
        if (server) {
            await new Promise((resolve) => server?.close(() => resolve()));
        }
        await (0, db_1.disconnectFromDatabase)();
        process.exit(0);
    }
    catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error during shutdown', error);
        process.exit(1);
    }
};
void start();
['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
        void shutdown(signal);
    });
});
//# sourceMappingURL=server.js.map