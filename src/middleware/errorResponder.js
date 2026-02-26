// middleware/errorResponder.js
//
// Express error middleware.
// Maps all errors to a consistent JSON response shape.

module.exports = (toHttpError, logger) => (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const httpErr = toHttpError(err);

  if (httpErr.status >= 500) {
    logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  }

  return res.status(httpErr.status).json({
    error: httpErr.message,
    code: httpErr.code,
  });
};
