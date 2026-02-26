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
    const session = await getSession(sessionId);

    if (typeof name !== "string") {
      throw new AppError("DISPLAY_NAME_REQUIRED");
    }

    const normalizedName = name.trim();

    if (!normalizedName) {
      throw new AppError("DISPLAY_NAME_REQUIRED");
    }

    const duplicate = session.guests.some(
      (g) => g.name.toLowerCase() === normalizedName.toLowerCase()
    );

    if (duplicate) {
      throw new AppError("DISPLAY_NAME_TAKEN");
    }

    const normalizedAvatarDataUrl = normalizeAvatarDataUrl(avatarDataUrl);

    const updatedSession = {
      ...session,
      guests: [
        ...session.guests,
        {
          name: normalizedName,
          avatarDataUrl: normalizedAvatarDataUrl,
          joinedAt: Date.now(),
        },
      ],
    };

    await persistSession(updatedSession);

    logger.info({ sessionId, guestName: normalizedName }, "Guest joined session");

    return {
      sessionId: updatedSession.sessionId,
      role: "guest",
      displayName: normalizedName,
      avatarDataUrl: normalizedAvatarDataUrl,
      profileImageUrl: session.hostProfileImageUrl,
    };
  };

  const leaveSession = async (sessionId, displayName) => {
    const session = await getSession(sessionId);

    const updatedSession = {
      ...session,
      guests: session.guests.filter((g) => g.name !== displayName),
    };

    await persistSession(updatedSession);

    logger.info({ sessionId, displayName }, "Guest left session");
    return updatedSession;
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
    endSession,
    persistSession,
  };
};
