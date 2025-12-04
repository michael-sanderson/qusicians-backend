// Generates Spotify authorization URL for OAuth login

module.exports = (C) => (state) =>
  C.SPOTIFY.AUTHORIZE_URL +
  "?" +
  new URLSearchParams({
    response_type: "code",
    client_id: C.clientId,
    scope: C.SPOTIFY.SCOPES,
    redirect_uri: C.redirectUri,
    state,
  });
