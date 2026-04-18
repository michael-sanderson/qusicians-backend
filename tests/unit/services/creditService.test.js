const createCreditService = require("../../../src/services/creditService");
const AppError = require("../../../src/errors/AppError");
const { createLogger } = require("../helpers/testDoubles");

describe("creditService", () => {
  const C = {
    KEY_PREFIX: "credits:",
    MAX: 3,
    REFILL_INTERVAL_SECONDS: 60,
    SESSION_TTL_SECONDS: 86400,
  };

  const buildService = (redisOverrides = {}) => {
    const redisClient = {
      eval: jest.fn(async () => [1, 2, Date.now() + 60000]),
      hGetAll: jest.fn(async () => ({})),
      hSet: jest.fn(async () => {}),
      expire: jest.fn(async () => {}),
      ...redisOverrides,
    };
    const logger = createLogger();
    const service = createCreditService(redisClient, C, logger, AppError);
    return { service, redisClient, logger };
  };

  test("host bypasses credit accounting entirely", async () => {
    const { service, redisClient } = buildService();
    const actor = { role: "host", userId: "host-1" };

    await expect(service.consumeCredit("s1", actor)).resolves.toEqual({
      allowed: true,
      remaining: null,
      nextRefillAt: null,
    });
    await expect(service.getCredits("s1", actor)).resolves.toEqual({
      allowed: true,
      remaining: null,
      nextRefillAt: null,
    });
    await expect(service.grantCredit("s1", actor)).resolves.toEqual({
      allowed: true,
      remaining: null,
      nextRefillAt: null,
    });

    expect(redisClient.eval).not.toHaveBeenCalled();
    expect(redisClient.hGetAll).not.toHaveBeenCalled();
    expect(redisClient.hSet).not.toHaveBeenCalled();
  });

  test("guest consume uses normalized guest credit key", async () => {
    const { service, redisClient } = buildService({
      eval: jest.fn(async () => [1, 1, 12345]),
    });

    await expect(
      service.consumeCredit("session-1", { role: "guest", displayName: " Baz " })
    ).resolves.toEqual({ allowed: true, remaining: 1, nextRefillAt: 12345 });

    expect(redisClient.eval).toHaveBeenCalledWith(expect.any(String), {
      keys: ["credits:session-1:guest:baz"],
      arguments: expect.arrayContaining(["3", "60000", "86400", "1"]),
    });
  });

  test("guest identity is required", async () => {
    const { service } = buildService();

    await expect(service.consumeCredit("s1", { role: "guest" })).rejects.toMatchObject({
      code: "CREDITS_IDENTITY_MISSING",
    });
  });

  test("grantCredit refills and caps guest credits", async () => {
    jest.spyOn(Date, "now").mockReturnValue(120000);
    const { service, redisClient } = buildService({
      hGetAll: jest.fn(async () => ({ credits: "2", last_refill_ms: "0" })),
    });

    await expect(
      service.grantCredit("session-1", { role: "guest", displayName: "Baz" })
    ).resolves.toEqual({ remaining: 3, nextRefillAt: 180000 });

    expect(redisClient.hSet).toHaveBeenCalledWith("credits:session-1:guest:baz", {
      credits: "3",
      last_refill_ms: "120000",
    });
    expect(redisClient.expire).toHaveBeenCalledWith("credits:session-1:guest:baz", 86400);
  });
});


describe("creditService additional branch coverage", () => {
  const C = {
    KEY_PREFIX: "credits:",
    MAX: 3,
    REFILL_INTERVAL_SECONDS: 60,
    SESSION_TTL_SECONDS: 86400,
  };

  test("logs denied consumes and defaults malformed eval output", async () => {
    const redisClient = { eval: jest.fn(async () => [0, undefined, undefined]) };
    const logger = createLogger();
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const service = createCreditService(redisClient, C, logger, AppError);

    await expect(service.consumeCredit("s1", { role: "guest", displayName: "Alice" })).resolves.toEqual({
      allowed: false,
      remaining: 0,
      nextRefillAt: 61000,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { sessionId: "s1", actorRole: "guest", nextRefillAt: 61000 },
      "Add denied due to exhausted credits"
    );
  });

  test("getCredits uses non-consuming script argument", async () => {
    const redisClient = { eval: jest.fn(async () => [1, 3, 1000]) };
    const service = createCreditService(redisClient, C, createLogger(), AppError);

    await service.getCredits("s1", { role: "guest", displayName: "Alice" });
    expect(redisClient.eval.mock.calls[0][1].arguments.at(-1)).toBe("0");
  });

  test("grantCredit handles missing, future, and no-earned stored states", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const states = [{}, { credits: "1", last_refill_ms: "2000" }, { credits: "1", last_refill_ms: "999" }];
    const redisClient = {
      hGetAll: jest.fn(async () => states.shift()),
      hSet: jest.fn(async () => {}),
      expire: jest.fn(async () => {}),
    };
    const service = createCreditService(redisClient, C, createLogger(), AppError);

    await service.grantCredit("s1", { role: "guest", displayName: "Alice" });
    await service.grantCredit("s1", { role: "guest", displayName: "Alice" });
    await service.grantCredit("s1", { role: "guest", displayName: "Alice" });

    expect(redisClient.hSet).toHaveBeenNthCalledWith(1, "credits:s1:guest:alice", {
      credits: "3",
      last_refill_ms: "1000",
    });
    expect(redisClient.hSet).toHaveBeenNthCalledWith(2, "credits:s1:guest:alice", {
      credits: "2",
      last_refill_ms: "2000",
    });
    expect(redisClient.hSet).toHaveBeenNthCalledWith(3, "credits:s1:guest:alice", {
      credits: "2",
      last_refill_ms: "999",
    });
  });
});
