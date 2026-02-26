// data/redisClient.js
//
// Redis client factory.
// Establishes a single shared Redis connection at startup.
// Redis is a critical dependency; startup fails if it cannot connect.

module.exports = (createClient, logger) => {
  // Create Redis client instance
  const client = createClient({
    url: process.env.REDIS_URL,
  });

  /* ------------------------------------------------------------------
   * Connection lifecycle logging
   * ------------------------------------------------------------------ */

  client.on("connect", () => logger.info("Redis connecting..."));
  client.on("ready", () => logger.info("Redis ready"));
  client.on("error", (err) => logger.error({ err }, "Redis error"));
  client.on("end", () => logger.warn("Redis connection closed"));

  /* ------------------------------------------------------------------
   * Initial connection (fire-and-forget)
   * ------------------------------------------------------------------ */

  client
    .connect()
    .then(() => logger.info("Redis connection established successfully"))
    .catch((err) => {
      logger.error({ err }, "Redis connection failed - shutting down");

      // Redis is a critical dependency; fail fast
      process.exit(1);
    });

  return client;
};
