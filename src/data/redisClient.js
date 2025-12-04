// config/redisClient.js

module.exports = (createClient, logger) => {
  const client = createClient({ url: process.env.REDIS_URL })

  // Event listeners
  client.on('connect', () => logger.info('Redis connecting...'))
  client.on('ready', () => logger.info('Redis ready'))
  client.on('error', err => logger.error({ err }, 'Redis error'))
  client.on('end', () => logger.warn('Redis connection closed'))

  // Connect immediately (fire-and-forget)
  client.connect()
    .then(() => logger.info('Redis connection established successfully'))
    .catch(err => {
      logger.error({ err }, 'Redis connection failed')
      process.exit(1) // stop server if Redis is critical
    })

  return client
}
