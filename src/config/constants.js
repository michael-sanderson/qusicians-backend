// config/constants.js

module.exports = {
  // Session-related constants
  SESSION_AND_STATE: {
    SESSION_PREFIX: "Qusicians:session:",
    STATE_PREFIX: "Qusicians:state:",
    SESSION_TTL_SECONDS: 24 * 60 * 60, // 24 hours
    STATE_TTL_SECONDS: 300 // 5 minutes
  },

  // Spotify API-related constants
  SPOTIFY: {
    API_BASE_URL: "https://api.spotify.com/v1",
    AUTHORIZE_URL: "https://accounts.spotify.com/authorize",
    TOKEN_URL: "https://accounts.spotify.com/api/token",

    // OAuth scopes required for controlling playback and reading currently playing track
    SCOPES: [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ].join(" "),
  },
};
