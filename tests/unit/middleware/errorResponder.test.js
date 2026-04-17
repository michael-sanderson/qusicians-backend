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
