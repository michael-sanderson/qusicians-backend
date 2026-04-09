// server.js
//
// Application entry point.
// Responsible only for environment setup, app creation, and listening.

require("dotenv").config();

const http = require("http");
const createApp = require("./app");
const buildDependencies = require("./bootstrap/dependencies");
const createQueueRealtimeGateway = require("./realtime/queueRealtimeGateway");

/* ------------------------------------------------------------------ */

const dependencies = buildDependencies();
const app = createApp(dependencies);
const httpServer = http.createServer(app);
createQueueRealtimeGateway(httpServer, dependencies);
const port = process.env.PORT || 3000;
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";

/* ------------------------------------------------------------------ */

// Start server
httpServer.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
