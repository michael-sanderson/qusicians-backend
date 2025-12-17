// utils/setPartySessionCookie.js
//
// Writes the partySession cookie used to identify a user’s session.
// Centralizes cookie policy to avoid configuration drift.

const COOKIE_NAME = "partySession";

const COOKIE_OPTIONS = {
  httpOnly: false, // intentional: frontend needs access
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 24 * 60 * 60 * 1000,
  path: "/",
};

module.exports = (res, sessionPayload) => {
  res.cookie(
    COOKIE_NAME,
    JSON.stringify(sessionPayload),
    COOKIE_OPTIONS
  );
};
