// services/creditService.js
//
// Per-actor credit bucket service.
// Uses Redis as source of truth and performs refill + consume atomically.

module.exports = (redisClient, C, logger, AppError) => {
  const normalizeStoredCredits = (vals, now, refillMs) => {
    const parsedCredits = Number(vals?.credits);
    const parsedLastRefillMs = Number(vals?.last_refill_ms);

    if (!Number.isFinite(parsedCredits) || !Number.isFinite(parsedLastRefillMs)) {
      return {
        credits: C.MAX,
        lastRefillMs: now,
      };
    }

    if (now <= parsedLastRefillMs) {
      return {
        credits: parsedCredits,
        lastRefillMs: parsedLastRefillMs,
      };
    }

    const earned = Math.floor((now - parsedLastRefillMs) / refillMs);
    if (earned <= 0) {
      return {
        credits: parsedCredits,
        lastRefillMs: parsedLastRefillMs,
      };
    }

    return {
      credits: Math.min(C.MAX, parsedCredits + earned),
      lastRefillMs: parsedLastRefillMs + earned * refillMs,
    };
  };

  const keyFor = (sessionId, actor) => {
    const role = actor?.role === "host" ? "host" : "guest";

    if (role === "host") {
      const hostUserId =
        typeof actor?.userId === "string" ? actor.userId.trim() : "";
      if (!hostUserId) {
        throw new AppError("CREDITS_IDENTITY_MISSING");
      }
      return `${C.KEY_PREFIX}${sessionId}:host:${hostUserId}`;
    }

    const guestName =
      typeof actor?.displayName === "string" ? actor.displayName.trim().toLowerCase() : "";
    if (!guestName) {
      throw new AppError("CREDITS_IDENTITY_MISSING");
    }
    return `${C.KEY_PREFIX}${sessionId}:guest:${guestName}`;
  };

  const consumeScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local maxCredits = tonumber(ARGV[2])
local refillMs = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])
local consume = tonumber(ARGV[5])

local vals = redis.call('HMGET', key, 'credits', 'last_refill_ms')
local credits = tonumber(vals[1])
local lastRefillMs = tonumber(vals[2])

if not credits or not lastRefillMs then
  credits = maxCredits
  lastRefillMs = now
end

if now > lastRefillMs then
  local elapsed = now - lastRefillMs
  local earned = math.floor(elapsed / refillMs)
  if earned > 0 then
    credits = math.min(maxCredits, credits + earned)
    lastRefillMs = lastRefillMs + (earned * refillMs)
  end
end

local allowed = 1
if consume == 1 then
  if credits < 1 then
    allowed = 0
  else
    credits = credits - 1
  end
end

redis.call('HSET', key, 'credits', credits, 'last_refill_ms', lastRefillMs)
redis.call('EXPIRE', key, ttlSeconds)

local nextRefillMs = lastRefillMs + refillMs
return { allowed, credits, nextRefillMs }
`;

  const run = async (sessionId, actor, consume) => {
    const key = keyFor(sessionId, actor);
    const now = Date.now();
    const result = await redisClient.eval(consumeScript, {
      keys: [key],
      arguments: [
        String(now),
        String(C.MAX),
        String(C.REFILL_INTERVAL_SECONDS * 1000),
        String(C.SESSION_TTL_SECONDS),
        consume ? "1" : "0",
      ],
    });

    const [allowedRaw, remainingRaw, nextRefillRaw] = result || [];
    return {
      allowed: Number(allowedRaw) === 1,
      remaining: Number(remainingRaw) || 0,
      nextRefillAt: Number(nextRefillRaw) || now + C.REFILL_INTERVAL_SECONDS * 1000,
    };
  };

  const consumeCredit = async (sessionId, actor) => {
    if (actor?.role === "host") {
      return {
        allowed: true,
        remaining: C.MAX,
        nextRefillAt: Date.now(),
      };
    }

    const result = await run(sessionId, actor, true);
    if (!result.allowed) {
      logger.info(
        { sessionId, actorRole: actor?.role, nextRefillAt: result.nextRefillAt },
        "Add denied due to exhausted credits"
      );
    }
    return result;
  };

  const getCredits = async (sessionId, actor) => run(sessionId, actor, false);

  const grantCredit = async (sessionId, actor) => {
    const key = keyFor(sessionId, actor);
    const now = Date.now();
    const refillMs = C.REFILL_INTERVAL_SECONDS * 1000;

    const vals = await redisClient.hGetAll(key);
    const normalizedState = normalizeStoredCredits(vals, now, refillMs);
    const credits = Math.min(C.MAX, normalizedState.credits + 1);
    const lastRefillMs = normalizedState.lastRefillMs;

    await redisClient.hSet(key, {
      credits: String(credits),
      last_refill_ms: String(lastRefillMs),
    });
    await redisClient.expire(key, C.SESSION_TTL_SECONDS);

    logger.debug({ sessionId, actorRole: actor?.role, credits }, "Granted play-based credit");

    return {
      remaining: credits,
      nextRefillAt: lastRefillMs + refillMs,
    };
  };

  return {
    consumeCredit,
    getCredits,
    grantCredit,
  };
};
