// middleware/logger.js
//
// Application logging utilities.
// Defines the global logger instance and request logging middleware.

const isProduction = process.env.NODE_ENV === "production";

/* ------------------------------------------------------------------ */

function createLogger(pino) {
  return pino({
    level: isProduction ? "info" : "debug",

    // Use pretty logging only in non-production environments
    transport: isProduction
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
  });
}

/* ------------------------------------------------------------------ */

// Express middleware for logging incoming HTTP requests.
// Keeps controllers and routes free of logging concerns.
function createRequestLogger(logger) {
  return function requestLogger(req, res, next) {
    logger.info(
      {
        method: req.method,
        url: req.url,
        userAgent: req.headers["user-agent"],
      },
      "Incoming request"
    );
    next();
  };
}

/* ------------------------------------------------------------------ */

module.exports = {
  createLogger,
  createRequestLogger,
};
