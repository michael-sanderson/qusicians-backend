const createErrorResponder = require("../../../src/middleware/errorResponder");
const { toHttpErrorFactory } = require("../../../src/errors");
const ERROR_CATALOG = require("../../../src/errors/errorCatalog");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

describe("errorResponder", () => {
  test("responds with catalog code and message", () => {
    const responder = createErrorResponder(toHttpErrorFactory(ERROR_CATALOG), createLogger());
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };

    responder(new AppError("INVALID_TRACK_URI"), { path: "/x", method: "GET" }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing or invalid track URI",
      code: "INVALID_TRACK_URI",
    });
  });

  test("delegates when headers already sent", () => {
    const next = jest.fn();
    const responder = createErrorResponder(toHttpErrorFactory(ERROR_CATALOG), createLogger());
    const err = new Error("boom");

    responder(err, {}, { headersSent: true }, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

  test("responds with metadata and logs server errors", () => {
    const logger = createLogger();
    const responder = createErrorResponder(() => ({
      status: 500,
      code: "NO_CREDITS",
      message: "No credits",
      meta: { nextRefillAt: 123, creditsRemaining: 0 },
    }), logger);
    const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error("boom");

    responder(err, { path: "/x", method: "POST" }, res, jest.fn());

    expect(logger.error).toHaveBeenCalledWith({ err, path: "/x", method: "POST" }, "Unhandled error");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "No credits",
      code: "NO_CREDITS",
      meta: { nextRefillAt: 123, creditsRemaining: 0 },
    });
  });

  test("toHttpError handles payload size, catalog metadata, and internal fallback", () => {
    const toHttpError = toHttpErrorFactory(ERROR_CATALOG);
    expect(toHttpError({ type: "entity.too.large" })).toEqual({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request payload too large",
    });
    expect(toHttpError({ code: "NO_CREDITS", nextRefillAt: 12, creditsRemaining: 0 })).toEqual({
      status: 429,
      code: "NO_CREDITS",
      message: ERROR_CATALOG.NO_CREDITS.message,
      meta: { nextRefillAt: 12, creditsRemaining: 0 },
    });
    expect(toHttpError(new Error("private"))).toEqual({
      status: ERROR_CATALOG.INTERNAL_ERROR.status,
      code: "INTERNAL_ERROR",
      message: ERROR_CATALOG.INTERNAL_ERROR.message,
    });
  });
