const { normalizeSearchQuery } = require("../../../../src/services/spotify/searchUtils");
const { formatTrack, normalizeTrackMeta, resolvePlaylistId } = require("../../../../src/services/spotify/trackUtils");
const {
  resolveAddedBy,
  normalizeAddedBy,
  normalizeAttributions,
  resolveGuestByName,
} = require("../../../../src/services/spotify/attributionUtils");

describe("spotify utility helpers", () => {
  test("normalizes search queries consistently", () => {
    expect(normalizeSearchQuery("  DrAkE   one dance  ")).toBe("drake one dance");
    expect(normalizeSearchQuery(null)).toBe("");
  });

  test("formats Spotify tracks to the client contract", () => {
    expect(
      formatTrack({
        name: "Song",
        artists: [{ name: "Artist" }],
        album: { name: "Album", images: [{ url: "art.jpg" }] },
        uri: "spotify:track:1",
      })
    ).toEqual({
      title: "Song",
      artist: "Artist",
      album: "Album",
      artwork: "art.jpg",
      uri: "spotify:track:1",
    });

    expect(formatTrack(null)).toBeNull();
  });

  test("normalizes optional track metadata", () => {
    expect(normalizeTrackMeta({ title: "T", artist: 7, album: "A", artwork: null })).toEqual({
      title: "T",
      artist: null,
      album: "A",
      artwork: null,
    });
    expect(normalizeTrackMeta(null)).toBeNull();
  });

  test("resolves Spotify playlist IDs from IDs, URIs, and URLs", () => {
    const id = "5d4928dc07074ca6887d2e";

    expect(resolvePlaylistId(id)).toBe(id);
    expect(resolvePlaylistId(`spotify:playlist:${id}`)).toBe(id);
    expect(resolvePlaylistId(`https://open.spotify.com/playlist/${id}?si=abc`)).toBe(id);
    expect(resolvePlaylistId("https://example.com/playlist/5d4928dc07074ca6887d2e")).toBeNull();
    expect(resolvePlaylistId(123)).toBeNull();
  });

  test("normalizes track attribution data", () => {
    const guest = { name: "Baz", avatarDataUrl: "data:image/png;base64,abc" };

    expect(resolveAddedBy({ role: "host" }, null, "host.jpg")).toEqual({
      name: "Host",
      role: "host",
      avatarDataUrl: "host.jpg",
    });
    expect(resolveAddedBy({ role: "guest", displayName: " Baz " }, guest)).toEqual({
      name: "Baz",
      role: "guest",
      avatarDataUrl: guest.avatarDataUrl,
    });
    expect(normalizeAddedBy("Host")).toEqual({ name: "Host", role: "host", avatarDataUrl: null });
    expect(normalizeAttributions([{ uri: "u1", addedBy: "Alice" }])).toEqual({
      u1: { name: "Alice", role: "guest", avatarDataUrl: null },
    });
    expect(resolveGuestByName([{ name: "Alice" }], " alice ")).toEqual({ name: "Alice" });
  });
});
