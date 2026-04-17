const createOauthStateService = require("../../../src/services/oauthStateService");

describe("oauthStateService", () => {
  test("generates, stores, verifies, and consumes OAuth state", async () => {
    const redisClient = {
      setEx: jest.fn(async () => {}),
      get: jest.fn(async () => "valid"),
      del: jest.fn(async () => 1),
    };
    const crypto = { randomBytes: jest.fn(() => Buffer.from("1234567890abcdef")) };
    const service = createOauthStateService(crypto, redisClient, {
      STATE_PREFIX: "oauth:",
      STATE_TTL_SECONDS: 300,
    });

    const state = await service.generateAndStoreState();
    expect(state).toBe(Buffer.from("1234567890abcdef").toString("hex"));
    expect(redisClient.setEx).toHaveBeenCalledWith(`oauth:${state}`, 300, "valid");

    await expect(service.verifyAndConsumeState(state)).resolves.toBe(true);
    expect(redisClient.get).toHaveBeenCalledWith(`oauth:${state}`);
    expect(redisClient.del).toHaveBeenCalledWith(`oauth:${state}`);
  });

  test("returns false for expired state", async () => {
    const service = createOauthStateService({}, { get: jest.fn(async () => null), del: jest.fn() }, {
      STATE_PREFIX: "oauth:",
    });

    await expect(service.verifyAndConsumeState("missing")).resolves.toBe(false);
  });
});
