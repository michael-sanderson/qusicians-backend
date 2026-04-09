// errors/AppError.js
//
// Typed application error carrying stable code + HTTP status.

const ERROR_CATALOG = require("./errorCatalog");

function AppError(code, overrideMessage) {
  const resolvedCode = code in ERROR_CATALOG ? code : "INTERNAL_ERROR";
  const definition = ERROR_CATALOG[resolvedCode] || ERROR_CATALOG.INTERNAL_ERROR;
  const error = Error.call(this, overrideMessage || definition.message);

  this.name = "AppError";
  this.message = error.message;
  this.code = resolvedCode;
  this.status = definition.status;
  this.stack = error.stack;
}

AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

module.exports = AppError;
