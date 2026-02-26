// errors/toHttpError.js
//
// Normalize any thrown error into a stable HTTP error shape.

module.exports = (ERROR_CATALOG) => (err) => {
  if (err?.type === "entity.too.large") {
    return {
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request payload too large",
    };
  }

  if (err?.code && ERROR_CATALOG[err.code]) {
    const def = ERROR_CATALOG[err.code];
    return {
      status: def.status,
      code: err.code,
      message: err.message || def.message,
    };
  }

  return {
    status: ERROR_CATALOG.INTERNAL_ERROR.status,
    code: "INTERNAL_ERROR",
    message: ERROR_CATALOG.INTERNAL_ERROR.message,
  };
};
