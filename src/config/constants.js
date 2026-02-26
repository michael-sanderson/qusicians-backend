// config/constants.js
//
// Centralized application constants.
// Contains only static configuration and policy values.
// No environment access or runtime logic should live here.

module.exports = {
  /* ------------------------------------------------------------------
   * Redis session & OAuth state storage policy
   * ------------------------------------------------------------------ */

  SESSION_AND_STATE: {
    // Redis key prefixes
    SESSION_PREFIX: "Qusicians:session:",
    SESSION_GUEST_PREFIX: "party:session:guests:",
    STATE_PREFIX: "Qusicians:state:",

    // Time-to-live values
    SESSION_TTL_SECONDS: 24 * 60 * 60, // 24 hours
    STATE_TTL_SECONDS: 5 * 60, // 5 minutes
  },

  /* ------------------------------------------------------------------
   * Spotify API configuration
   * ------------------------------------------------------------------ */

  SPOTIFY: {
    API_BASE_URL: "https://api.spotify.com/v1",
    AUTHORIZE_URL: "https://accounts.spotify.com/authorize",
    TOKEN_URL: "https://accounts.spotify.com/api/token",

    // OAuth scopes required for playback control and playlist access
    SCOPES: [
      "playlist-modify-private",
      "playlist-read-private",
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ].join(" "),
  },
};
