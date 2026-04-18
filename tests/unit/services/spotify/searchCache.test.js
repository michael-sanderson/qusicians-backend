const createSearchCache = require("../../../../src/services/spotify/searchCache");

describe("searchCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns cached values until ttl expires", () => {
    const cache = createSearchCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set("drake", ["track"]);

    expect(cache.get("drake")).toEqual(["track"]);

    jest.advanceTimersByTime(1001);
    expect(cache.get("drake")).toBeNull();
  });

  test("evicts oldest entries when max size is exceeded", () => {
    const cache = createSearchCache({ ttlMs: 10000, maxEntries: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });
});

  test("prunes expired entries before inserting new values", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const cache = createSearchCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set("old", 1);
    jest.advanceTimersByTime(1001);
    cache.set("new", 2);

    expect(cache.get("old")).toBeNull();
    expect(cache.get("new")).toBe(2);
    jest.useRealTimers();
  });



