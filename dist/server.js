"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const { port } = env_1.config.app;
app_1.app.listen(port, () => {
    console.log(`Backend running on port ${port}`);
});
//# sourceMappingURL=server.js.map