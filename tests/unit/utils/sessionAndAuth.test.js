const { parseSessionCookie } = require("../../../src/utils/sessionUtil");
const createSpotifyAuthUtil = require("../../../src/utils/spotifyAuthUtil");

describe("session and auth utilities", () => {
  test("parseSessionCookie decodes valid cookie payload", () => {
    const payload = {
      sessionId: "s1",
      role: "guest",
      displayName: "Alice",
      avatarDataUrl: "avatar",
    };

    expect(parseSessionCookie(JSON.stringify(payload))).toEqual({
      ok: true,
      sessionId: "s1",
      role: "guest",
      userId: null,
      displayName: "Alice",
      avatarDataUrl: "avatar",
      data: payload,
    });
  });

  test("parseSessionCookie classifies missing, invalid, and malformed cookies", () => {
    expect(parseSessionCookie(null)).toEqual({ ok: false, error: "Missing session cookie" });
    expect(parseSessionCookie(JSON.stringify({ role: "guest" }))).toEqual({
      ok: false,
      error: "Invalid session cookie",
    });
    expect(parseSessionCookie("{" )).toEqual({ ok: false, error: "Malformed session cookie" });
  });

  test("spotifyAuthUtil builds authorization URL with configured scope and redirect", () => {
    const buildAuthUrl = createSpotifyAuthUtil({
      clientId: "client-id",
      redirectUri: "https://api.test/callback",
      SPOTIFY: {
        AUTHORIZE_URL: "https://accounts.spotify.com/authorize",
        SCOPES: "user-read-email playlist-modify-private",
      },
    });

    const url = new URL(buildAuthUrl("state-1"));
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.test/callback");
    expect(url.searchParams.get("scope")).toBe("user-read-email playlist-modify-private");
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});
