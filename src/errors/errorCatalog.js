// errors/errorCatalog.js
//
// Central registry of domain/application errors.
// Controllers use `status` for HTTP responses.
// Clients receive `code` + `message`.

const ERROR_CATALOG = {
  SESSION_NOT_FOUND: {
    status: 404,
    message: "Session not found",
  },
  SESSION_INVALID_OR_EXPIRED: {
    status: 401,
    message: "Session expired or invalid",
  },
  SESSION_COOKIE_MISSING: {
    status: 401,
    message: "Missing session cookie",
  },
  SESSION_COOKIE_INVALID: {
    status: 401,
    message: "Invalid session cookie",
  },
  SESSION_COOKIE_MALFORMED: {
    status: 401,
    message: "Malformed session cookie",
  },
  DISPLAY_NAME_REQUIRED: {
    status: 400,
    message: "Display name required",
  },
  DISPLAY_NAME_TAKEN: {
    status: 409,
    message: "Display name already taken",
  },
  INVALID_AVATAR_IMAGE: {
    status: 400,
    message: "Invalid avatar image format",
  },
  AVATAR_IMAGE_TOO_LARGE: {
    status: 400,
    message: "Avatar image exceeds size limit",
  },
  MISSING_SESSION_ID: {
    status: 400,
    message: "Missing sessionId",
  },
  FORBIDDEN_HOST_ONLY: {
    status: 403,
    message: "Only hosts can perform this action",
  },
  INVALID_PLAYLIST_ID: {
    status: 400,
    message: "Missing or invalid playlist ID",
  },
  PLAYLIST_NOT_FOUND: {
    status: 404,
    message: "Playlist not found or inaccessible",
  },
  PLAYLIST_ACCESS_DENIED: {
    status: 403,
    message: "Playlist is private or access is denied",
  },
  SPOTIFY_RATE_LIMITED: {
    status: 429,
    message: "Spotify rate limit reached. Please try again shortly",
  },
  INVALID_TRACK_URI: {
    status: 400,
    message: "Missing or invalid track URI",
  },
  INVALID_SEARCH_QUERY: {
    status: 400,
    message: "Missing or invalid search query",
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "Internal server error",
  },
  OAUTH_CODE_OR_STATE_MISSING: {
  status: 400,
  message: "Missing code or state",
},
OAUTH_STATE_INVALID: {
  status: 400,
  message: "Invalid state",
},
SPOTIFY_OAUTH_INIT_FAILED: {
  status: 500,
  message: "Internal error initiating Spotify OAuth",
},
SPOTIFY_CALLBACK_FAILED: {
  status: 500,
  message: "Error processing Spotify callback",
},
SPOTIFY_QUEUE_FETCH_FAILED: {
  status: 500,
  message: "Failed to get Spotify queue",
},
SPOTIFY_ADD_FAILED: {
  status: 500,
  message: "Error adding track to Spotify playlist",
},
SPOTIFY_SEARCH_FAILED: {
  status: 500,
  message: "Error fetching tracks from search",
},
};

module.exports = ERROR_CATALOG;
