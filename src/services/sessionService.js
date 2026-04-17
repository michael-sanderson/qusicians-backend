// services/sessionService.js
//
// Session domain service.
// Owns session lifecycle and guest membership invariants.
// Uses injected dependencies only (no direct infrastructure imports).

module.exports = (redisClient, logger, C, AppError) => {
  const sessionKey = (sessionId) => `${C.SESSION_PREFIX}${sessionId}`;
  const MAX_AVATAR_DATA_URL_LENGTH = 512_000;
  const AVATAR_DATA_URL_PATTERN =
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;
  const NULL_SENTINEL = "__NULL__";
  const joinSessionScript = `
local key = KEYS[1]
local normalizedName = ARGV[1]
local avatarJson = ARGV[2]
local joinedAt = tonumber(ARGV[3])
local fallbackTtl = tonumber(ARGV[4])

local raw = redis.call('GET', key)
if not raw then
  return cjson.encode({ ok = false, code = "SESSION_NOT_FOUND" })
end

local session = cjson.decode(raw)
local guests = session.guests or {}

for i = 1, #guests do
  local guestName = guests[i].name or ""
  if string.lower(guestName) == string.lower(normalizedName) then
    return cjson.encode({ ok = false, code = "DISPLAY_NAME_TAKEN" })
  end
end

local avatarDataUrl = cjson.null
if avatarJson ~= "${NULL_SENTINEL}" then
  avatarDataUrl = cjson.decode(avatarJson)
end

table.insert(guests, {
  name = normalizedName,
  avatarDataUrl = avatarDataUrl,
  joinedAt = joinedAt
})

session.guests = guests

local ttl = tonumber(session.ttl) or fallbackTtl
redis.call('SETEX', key, ttl, cjson.encode(session))

return cjson.encode({
  ok = true,
  sessionId = session.sessionId,
  profileImageUrl = session.hostProfileImageUrl,
  avatarDataUrl = avatarDataUrl
})
`;
  const leaveSessionScript = `
local key = KEYS[1]
local displayName = ARGV[1]
local fallbackTtl = tonumber(ARGV[2])

local raw = redis.call('GET', key)
if not raw then
  return cjson.encode({ ok = false, code = "SESSION_NOT_FOUND" })
end

local session = cjson.decode(raw)
local guests = session.guests or {}
local filteredGuests = {}

for i = 1, #guests do
  local guest = guests[i]
  if guest.name ~= displayName then
    table.insert(filteredGuests, guest)
  end
end

session.guests = filteredGuests

local ttl = tonumber(session.ttl) or fallbackTtl
redis.call('SETEX', key, ttl, cjson.encode(session))

return cjson.encode({ ok = true })
`;
  const appendPendingTrackScript = `
local key = KEYS[1]
local pendingTrackJson = ARGV[1]
local addedByJson = ARGV[2]
local fallbackTtl = tonumber(ARGV[3])

local raw = redis.call('GET', key)
if not raw then
  return cjson.encode({ ok = false, code = "SESSION_NOT_FOUND" })
end

local session = cjson.decode(raw)
local pendingTracks = session.pendingTracks or {}
local trackAttributions = session.trackAttributions or {}
local pendingTrack = cjson.decode(pendingTrackJson)
local addedBy = cjson.decode(addedByJson)

for i = 1, #pendingTracks do
  local existingTrack = pendingTracks[i]
  if existingTrack.uri == pendingTrack.uri then
    return cjson.encode({
      ok = true,
      duplicate = true,
      duplicateReason = "pending",
      existingPendingTrackId = existingTrack.id,
      requestedBy = existingTrack.addedBy
    })
  end
end

if trackAttributions[pendingTrack.uri] then
  return cjson.encode({
    ok = true,
    duplicate = true,
    duplicateReason = "previously_requested",
    existingPendingTrackId = cjson.null,
    requestedBy = trackAttributions[pendingTrack.uri]
  })
end

table.insert(pendingTracks, pendingTrack)
trackAttributions[pendingTrack.uri] = addedBy

session.pendingTracks = pendingTracks
session.trackAttributions = trackAttributions

local ttl = tonumber(session.ttl) or fallbackTtl
redis.call('SETEX', key, ttl, cjson.encode(session))

return cjson.encode({ ok = true, duplicate = false })
`;
  const removePendingTrackScript = `
local key = KEYS[1]
local pendingTrackId = ARGV[1]
local fallbackTtl = tonumber(ARGV[2])

local raw = redis.call('GET', key)
if not raw then
  return cjson.encode({ ok = false, code = "SESSION_NOT_FOUND" })
end

local session = cjson.decode(raw)
local pendingTracks = session.pendingTracks or {}
local nextPendingTracks = {}
local removed = false

for i = 1, #pendingTracks do
  local track = pendingTracks[i]
  if track.id == pendingTrackId then
    removed = true
  else
    table.insert(nextPendingTracks, track)
  end
end

session.pendingTracks = nextPendingTracks

local ttl = tonumber(session.ttl) or fallbackTtl
redis.call('SETEX', key, ttl, cjson.encode(session))

return cjson.encode({ ok = true, removed = removed })
`;

  /* ------------------------------------------------------------------
   * Session lifecycle
   * ------------------------------------------------------------------ */

  const createHostSession = async (sessionObj) => {
    const session = {
      ...sessionObj,
      createdAt: Date.now(),
      ttl: C.SESSION_TTL_SECONDS,
      guests: [],
      trackAttributions: {},
      pendingTracks: [],
      confirmedTracks: [],
      currentNowPlayingSnapshot: null,
      lastPlayedTrack: null,
    };

    await persistSession(session);

    logger.info({ sessionId: session.sessionId }, "Host session created");
    return session;
  };

  const getSession = async (sessionId) => {
    const raw = await redisClient.get(sessionKey(sessionId));

    if (!raw) {
      logger.warn({ sessionId }, "Session not found");
      throw new AppError("SESSION_NOT_FOUND");
    }

    return JSON.parse(raw);
  };

  /* ------------------------------------------------------------------
   * Join / leave
   * ------------------------------------------------------------------ */

  const joinSession = async (sessionId, name, avatarDataUrl = null) => {
    if (typeof name !== "string") {
      throw new AppError("DISPLAY_NAME_REQUIRED");
    }

    const normalizedName = name.trim();

    if (!normalizedName) {
      throw new AppError("DISPLAY_NAME_REQUIRED");
    }

    const normalizedAvatarDataUrl = normalizeAvatarDataUrl(avatarDataUrl);
    const rawResult = await redisClient.eval(joinSessionScript, {
      keys: [sessionKey(sessionId)],
      arguments: [
        normalizedName,
        normalizedAvatarDataUrl ? JSON.stringify(normalizedAvatarDataUrl) : NULL_SENTINEL,
        String(Date.now()),
        String(C.SESSION_TTL_SECONDS),
      ],
    });
    const result = JSON.parse(rawResult);

    if (!result?.ok) {
      throw new AppError(result?.code || "SESSION_NOT_FOUND");
    }

    logger.info({ sessionId, guestName: normalizedName }, "Guest joined session");

    return {
      sessionId: result.sessionId,
      role: "guest",
      displayName: normalizedName,
      avatarDataUrl: normalizedAvatarDataUrl,
      profileImageUrl: result.profileImageUrl || null,
    };
  };

  const leaveSession = async (sessionId, displayName) => {
    const rawResult = await redisClient.eval(leaveSessionScript, {
      keys: [sessionKey(sessionId)],
      arguments: [displayName, String(C.SESSION_TTL_SECONDS)],
    });
    const result = JSON.parse(rawResult);

    if (!result?.ok) {
      throw new AppError(result?.code || "SESSION_NOT_FOUND");
    }

    logger.info({ sessionId, displayName }, "Guest left session");
    return true;
  };

  const appendPendingTrack = async (sessionId, pendingTrack, addedBy) => {
    const rawResult = await redisClient.eval(appendPendingTrackScript, {
      keys: [sessionKey(sessionId)],
      arguments: [
        JSON.stringify(pendingTrack),
        JSON.stringify(addedBy),
        String(C.SESSION_TTL_SECONDS),
      ],
    });
    const result = JSON.parse(rawResult);

    if (!result?.ok) {
      throw new AppError(result?.code || "SESSION_NOT_FOUND");
    }

    if (result.duplicate) {
      logger.info(
        {
          sessionId,
          existingPendingTrackId: result.existingPendingTrackId,
          trackUri: pendingTrack.uri,
        },
        "Duplicate pending track request squashed"
      );

      return {
        appended: false,
        duplicate: true,
        duplicateReason: result.duplicateReason || "pending",
        existingPendingTrackId: result.existingPendingTrackId || null,
        requestedBy: result.requestedBy || null,
      };
    }

    logger.info(
      { sessionId, pendingTrackId: pendingTrack.id, trackUri: pendingTrack.uri },
      "Pending track appended to session"
    );
    return {
      appended: true,
      duplicate: false,
    };
  };

  const removePendingTrack = async (sessionId, pendingTrackId) => {
    const rawResult = await redisClient.eval(removePendingTrackScript, {
      keys: [sessionKey(sessionId)],
      arguments: [pendingTrackId, String(C.SESSION_TTL_SECONDS)],
    });
    const result = JSON.parse(rawResult);

    if (!result?.ok) {
      throw new AppError(result?.code || "SESSION_NOT_FOUND");
    }

    logger.info(
      { sessionId, pendingTrackId, removed: Boolean(result.removed) },
      "Pending track removed from session"
    );

    return Boolean(result.removed);
  };

  const endSession = async (sessionId) => {
    const deletedCount = await redisClient.del(sessionKey(sessionId));

    if (deletedCount === 0) {
      throw new AppError("SESSION_NOT_FOUND");
    }

    logger.info({ sessionId }, "Session ended by host");
    return true;
  };

  /* ------------------------------------------------------------------ */

  const normalizeAvatarDataUrl = (rawAvatarDataUrl) => {
    if (!rawAvatarDataUrl) return null;

    if (typeof rawAvatarDataUrl !== "string") {
      throw new AppError("INVALID_AVATAR_IMAGE");
    }

    const normalized = rawAvatarDataUrl.trim();

    if (!normalized) {
      return null;
    }

    if (normalized.length > MAX_AVATAR_DATA_URL_LENGTH) {
      throw new AppError("AVATAR_IMAGE_TOO_LARGE");
    }

    if (!AVATAR_DATA_URL_PATTERN.test(normalized)) {
      throw new AppError("INVALID_AVATAR_IMAGE");
    }

    return normalized;
  };

  const persistSession = async (session) => {
    const ttl = session.ttl || C.SESSION_TTL_SECONDS;

    await redisClient.setEx(
      sessionKey(session.sessionId),
      ttl,
      JSON.stringify(session)
    );

    return session;
  };

  /* ------------------------------------------------------------------ */

  return {
    createHostSession,
    getSession,
    joinSession,
    leaveSession,
    appendPendingTrack,
    removePendingTrack,
    endSession,
    persistSession,
  };
};
