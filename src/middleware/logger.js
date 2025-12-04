// Factory function: inject pino dependency, returns configured logger

module.exports = (pino) => pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
  }
})
