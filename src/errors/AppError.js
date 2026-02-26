// errors/AppError.js
//
// Typed application error carrying stable code + HTTP status.

const ERROR_CATALOG = require("./errorCatalog");

class AppError extends Error {
  constructor(code, overrideMessage) {
    const def = ERROR_CATALOG[code] || ERROR_CATALOG.INTERNAL_ERROR;
    super(overrideMessage || def.message);
    this.name = "AppError";
    this.code = code in ERROR_CATALOG ? code : "INTERNAL_ERROR";
    this.status = def.status;
  }
}

module.exports = AppError;
