// errors/index.js
//
// Error module barrel export.

const AppError = require("./AppError");
const ERROR_CATALOG = require("./errorCatalog");
const toHttpErrorFactory = require("./toHttpError");

module.exports = {
  AppError,
  ERROR_CATALOG,
  toHttpErrorFactory
};
