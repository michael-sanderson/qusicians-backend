// utils/parseSessionCookie.js
//
// Parses and validates the partySession cookie.
// Returns a normalized result object instead of throwing,
// so callers can handle invalid cookies explicitly.

const ERR_MISSING = "Missing session cookie";
const ERR_INVALID = "Invalid session cookie";
const ERR_MALFORMED = "Malformed session cookie";

module.exports = (rawCookie) => {
  // No cookie present
  if (!rawCookie) {
    return { ok: false, error: ERR_MISSING };
  }

  try {
    const parsed = JSON.parse(rawCookie);

    // Must at least contain a sessionId
    if (!parsed || !parsed.sessionId) {
      return { ok: false, error: ERR_INVALID };
    }

    return {
      ok: true,
      sessionId: parsed.sessionId,
      role: parsed.role ?? null,
      userId: parsed.userId ?? null,
      data: parsed, // full cookie payload if needed downstream
    };
  } catch {
    // JSON.parse failed
    return { ok: false, error: ERR_MALFORMED };
  }
};
