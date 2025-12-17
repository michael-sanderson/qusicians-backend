// server.js
//
// Application entry point.
// Responsible only for environment setup, app creation, and listening.

require("dotenv").config();

const createApp = require("./app");

/* ------------------------------------------------------------------ */

const app = createApp();
const port = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */

// Start server
app.listen(port, "127.0.0.1", () => {
  console.log(`Server listening on http://127.0.0.1:${port}`);
});
