// utils/sessionUtil.js
//
// Session cookie utilities.
// Responsible only for encoding/decoding/clearing the session cookie.
// No knowledge of Redis, services, or HTTP routing.

const COOKIE_NAME = "partySession";
const isProduction = process.env.NODE_ENV === "production";

/* ------------------------------------------------------------------ */
/* Cookie options                                                      */
/* ------------------------------------------------------------------ */

const COOKIE_OPTIONS = {
  httpOnly: false, // intentional: frontend needs access
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/",
};

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

const ERR_MISSING = "Missing session cookie";
const ERR_INVALID = "Invalid session cookie";
const ERR_MALFORMED = "Malformed session cookie";

const parseSessionCookie = (rawCookie) => {
  if (!rawCookie) {
    return { ok: false, error: ERR_MISSING };
  }

  try {
    const parsed = JSON.parse(rawCookie);

    if (!parsed || !parsed.sessionId) {
      return { ok: false, error: ERR_INVALID };
    }

    return {
      ok: true,
      sessionId: parsed.sessionId,
      role: parsed.role ?? null,
      userId: parsed.userId ?? null,
      displayName: parsed.displayName ?? null,
      avatarDataUrl: parsed.avatarDataUrl ?? null,
      data: parsed,
    };
  } catch {
    return { ok: false, error: ERR_MALFORMED };
  }
};

/* ------------------------------------------------------------------ */
/* Set                                                                 */
/* ------------------------------------------------------------------ */

const setSessionCookie = (res, sessionPayload) => {
  res.cookie(COOKIE_NAME, JSON.stringify(sessionPayload), COOKIE_OPTIONS);
};

/* ------------------------------------------------------------------ */
/* Clear                                                               */
/* ------------------------------------------------------------------ */

const clearSessionCookie = (res) => {
  res.clearCookie(COOKIE_NAME, {
    secure: COOKIE_OPTIONS.secure,
    sameSite: COOKIE_OPTIONS.sameSite,
    path: COOKIE_OPTIONS.path,
  });
};

/* ------------------------------------------------------------------ */

module.exports = {
  parseSessionCookie,
  setSessionCookie,
  clearSessionCookie,
};
