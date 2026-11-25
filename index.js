// YouTube Music plugin for YesPlayMusic.
//
// Everything goes through YouTube Music's own web API (/youtubei/v1), signed
// out, as a visitor with an id YouTube hands out. Audio comes from the player
// answer YouTube gives its visionOS app, whose addresses play as they are, and
// libmpv in the app decodes the AAC or Opus directly. Timed lyrics come from
// the answer YouTube gives its Android app.

const site = "https://music.youtube.com";
const webUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const t = host.t;

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// ── Talking to YouTube ──

const webVersion = () => `1.${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.01.00`;
const hl = () => {
  const lang = host.language() || "en";
  return lang === "zh-CN" || lang === "zh-TW" ? lang : lang.split("-")[0];
};

const visionUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

// The visitor id ties requests together; continuations need the same one.
let visitor = host.storage.get("visitor") || "";

// Playback uses its own short-lived visionOS visitor id in memory. A stale web
// visitor id from storage can land in a restricted experiment bucket and make
// googlevideo.com return 403 for full-file requests.
let playerVisitor = "";
let playerVisitorUntil = 0;

const clients = {
  web: () => ({
    signedIn: true,
    client: { clientName: "WEB_REMIX", clientVersion: webVersion(), hl: hl(), visitorData: visitor || undefined },
    headers: { "user-agent": webUA, "x-youtube-client-name": "67", "x-youtube-client-version": webVersion() },
  }),
  android: () => ({
    client: { clientName: "ANDROID_MUSIC", clientVersion: "7.21.50", androidSdkVersion: 34, hl: hl() },
    headers: { "user-agent": "com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 14) gzip" },
  }),
  vision: (v = playerVisitor) => ({
    visitor: v,
    client: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      osName: "visionOS",
      osVersion: "26.5.23O471",
      userAgent: visionUA,
      visitorData: v || undefined,
    },
    headers: { "user-agent": visionUA, "x-youtube-client-name": "101", "x-youtube-client-version": "1.02" },
  }),
};

async function ensureVisitor() {
  if (visitor) return visitor;
  const r = await post("visitor_id", {}, clients.web());
  visitor = r.responseContext?.visitorData || "";
  if (visitor) host.storage.set("visitor", visitor);
  return visitor;
}

async function ensurePlayerVisitor(force = false) {
  if (!force && playerVisitor && playerVisitorUntil > Date.now()) return playerVisitor;
  const r = await post("visitor_id", {}, clients.vision(""));
  playerVisitor = r.responseContext?.visitorData || "";
  playerVisitorUntil = Date.now() + 3600e3;
  return playerVisitor;
}

// ── Session ──
// After signing in, the Cookie header of music.youtube.com is kept in storage
// and sent with requests as the web client, with the SAPISIDHASH Google's own
// page sends.

const cookie = () => host.storage.get("cookie") || "";

function cookieValue(name) {
  for (const part of cookie().split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function sessionHeaders() {
  const sapisid = cookieValue("SAPISID") || cookieValue("__Secure-3PAPISID");
  if (!sapisid) return {};
  const ts = Math.floor(Date.now() / 1000);
  return {
    cookie: cookie(),
    authorization: `SAPISIDHASH ${ts}_${sha1(`${ts} ${sapisid} ${site}`)}`,
    "x-goog-authuser": "0",
  };
}

// SHA-1 of a string's UTF-8 bytes, as hex. Only for the header above.
function sha1(text) {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let i = 0; i < words.length; i += 16) {
    for (let j = 0; j < 80; j++) w[j] = j < 16 ? words[i + j] : rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let [A, B, C, D, E] = [a, b, c, d, e];
    for (let j = 0; j < 80; j++) {
      const f = j < 20 ? (B & C) | (~B & D) : j < 40 ? B ^ C ^ D : j < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(A, 5) + f + E + k + w[j]) >>> 0;
      [E, D, C, B, A] = [D, C, rol(B, 30) >>> 0, A, tmp];
    }
    [a, b, c, d, e] = [(a + A) >>> 0, (b + B) >>> 0, (c + C) >>> 0, (d + D) >>> 0, (e + E) >>> 0];
  }
  return [a, b, c, d, e].map((x) => x.toString(16).padStart(8, "0")).join("");
}

async function post(endpoint, body, as) {
  const headers = { "content-type": "application/json", origin: site, "x-origin": site, ...as.headers };
  const vid = as.visitor !== undefined ? as.visitor : visitor;
  if (vid) headers["x-goog-visitor-id"] = vid;
  if (as.signedIn) Object.assign(headers, sessionHeaders());
  const res = await fetch(`${site}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers,
    body: JSON.stringify({ context: { client: as.client }, ...body }),
  });
  if (!res.ok) throw new Error(`YouTube ${endpoint}: HTTP ${res.status}`);
  return res.json();
}

async function call(endpoint, body, client = "web") {
  await ensureVisitor();
  return post(endpoint, body, clients[client]());
}

// ── Reading answers ──
// Answers are deep and their shape moves around, so parts are found by name.

function findAll(node, key, out = []) {
  if (Array.isArray(node)) for (const v of node) findAll(v, key, out);
  else if (node && typeof node === "object") {
    for (const k in node) {
      if (k === key) out.push(node[k]);
      else findAll(node[k], key, out);
    }
  }
  return out;
}
const find = (node, key) => findAll(node, key)[0];

const textOf = (t) => (t ? t.simpleText ?? (t.runs || []).map((r) => r.text).join("") : "");
const runsOf = (t) => (t && t.runs) || [];

function imageOf(node) {
  const list = find(node, "thumbnails");
  if (!list || !list.length) return "";
  const url = list[list.length - 1].url || "";
  // Ask googleusercontent for a larger square than the list gives.
  return url.replace(/=w\d+-h\d+/, "=w544-h544");
}

const browseIdOf = (nav) => nav?.browseEndpoint?.browseId || "";
const pageTypeOf = (nav) =>
  nav?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || "";

function msOf(text) {
  if (!/^\d+(:\d{1,2})+$/.test(text || "")) return 0;
  return text.split(":").reduce((s, p) => s * 60 + Number(p), 0) * 1000;
}

const yearOf = (text) => (String(text || "").match(/\b(19|20)\d{2}\b/) || [""])[0];

// Who and which album, from runs that link to them.
function creditsOf(runs) {
  const artists = [];
  let album = null;
  for (const r of runs) {
    const nav = r.navigationEndpoint;
    const type = pageTypeOf(nav);
    if (type === "MUSIC_PAGE_TYPE_ARTIST" || type === "MUSIC_PAGE_TYPE_USER_CHANNEL") {
      artists.push({ id: browseIdOf(nav), name: r.text });
    } else if (type === "MUSIC_PAGE_TYPE_ALBUM") {
      album = { id: browseIdOf(nav), name: r.text };
    }
  }
  return { artists, album };
}

// A row of a list: a track, or an album, artist or playlist in search.
function columnsOf(row) {
  return (row.flexColumns || []).map((c) => runsOf(c.musicResponsiveListItemFlexColumnRenderer?.text));
}

function trackOfRow(row, ctx = {}) {
  const id = row.playlistItemData?.videoId || find(row.flexColumns, "watchEndpoint")?.videoId;
  if (!id) return null;
  const cols = columnsOf(row);
  const name = (cols[0] || []).map((r) => r.text).join("");
  const rest = cols.slice(1).flat();
  const { artists, album } = creditsOf(rest);
  let duration = 0;
  for (const r of rest) duration ||= msOf(r.text);
  for (const c of row.fixedColumns || []) duration ||= msOf(textOf(c.musicResponsiveListItemFixedColumnRenderer?.text));
  // An artist's name without a link, as some rows give: the first run.
  if (!artists.length && !ctx.artists?.length && rest[0] && !rest[0].navigationEndpoint && rest[0].text.trim() !== "•") {
    artists.push({ id: "", name: rest[0].text });
  }
  const image = imageOf(row.thumbnail) || ctx.image || "";
  const a = album || ctx.album;
  return {
    id,
    name,
    artists: artists.length ? artists : ctx.artists || [],
    album: a ? { ...a, imageUrl: ctx.album?.id === a.id && ctx.image ? ctx.image : image } : { id: "", name: "", imageUrl: image },
    duration,
    unavailable: row.musicItemRendererDisplayPolicy === "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT" || undefined,
  };
}

// A row in search that isn't a track.
function itemOfRow(row) {
  const nav = row.navigationEndpoint;
  const id = browseIdOf(nav);
  if (!id) return null;
  const cols = columnsOf(row);
  const name = (cols[0] || []).map((r) => r.text).join("");
  const sub = cols[1] || [];
  const image = imageOf(row.thumbnail);
  switch (pageTypeOf(nav)) {
    case "MUSIC_PAGE_TYPE_ALBUM":
      return { kind: "album", value: { id, name, imageUrl: image, artists: creditsOf(sub).artists, released: yearOf(textOf({ runs: sub })) } };
    case "MUSIC_PAGE_TYPE_ARTIST":
    case "MUSIC_PAGE_TYPE_USER_CHANNEL":
      return { kind: "artist", value: { id, name, imageUrl: image } };
    case "MUSIC_PAGE_TYPE_PLAYLIST": {
      const count = sub.map((r) => r.text).find((s) => /\d/.test(s) && !/[:]/.test(s) && /首|song|track/i.test(s));
      return {
        kind: "playlist",
        value: { id, name, imageUrl: image, owner: sub[0]?.text || "", trackCount: count ? Number(count.replace(/\D/g, "")) : 0 },
      };
    }
  }
  return null;
}

// A card in a carousel.
function itemOfCard(card) {
  const nav = card.navigationEndpoint || {};
  const name = textOf(card.title);
  const sub = runsOf(card.subtitle);
  const image = imageOf(card.thumbnailRenderer);
  const watch = nav.watchEndpoint;
  if (watch?.videoId) {
    const { artists, album } = creditsOf(sub);
    return { kind: "track", value: { id: watch.videoId, name, artists, album: { ...(album || { id: "", name: "" }), imageUrl: image } } };
  }
  const id = browseIdOf(nav);
  switch (pageTypeOf(nav)) {
    case "MUSIC_PAGE_TYPE_ALBUM":
      return { kind: "album", value: { id, name, imageUrl: image, artists: creditsOf(sub).artists, released: yearOf(textOf(card.subtitle)) } };
    case "MUSIC_PAGE_TYPE_ARTIST":
    case "MUSIC_PAGE_TYPE_USER_CHANNEL":
      return { kind: "artist", value: { id, name, imageUrl: image } };
    case "MUSIC_PAGE_TYPE_PLAYLIST":
      return { kind: "playlist", value: { id, name, imageUrl: image, owner: textOf(card.subtitle) } };
  }
  return null;
}

// Sorts items into a section's or a search's lists.
function sorted(items) {
  const out = { tracks: [], albums: [], artists: [], playlists: [] };
  for (const it of items) if (it) out[it.kind + "s"].push(it.value);
  return out;
}

function itemsOf(node) {
  const items = [];
  for (const c of node.contents || node.items || []) {
    if (c.musicTwoRowItemRenderer) items.push(itemOfCard(c.musicTwoRowItemRenderer));
    else if (c.musicResponsiveListItemRenderer) {
      const r = c.musicResponsiveListItemRenderer;
      const tr = trackOfRow(r);
      items.push(tr ? { kind: "track", value: tr } : itemOfRow(r));
    }
  }
  return items;
}

// The token for more of a list, in either of the shapes YouTube uses.
function continuationOf(node) {
  return find(node, "nextContinuationData")?.continuation || find(node, "continuationCommand")?.token || "";
}

// ── Pages ──

function sectionsOf(answer) {
  const out = [];
  for (const shelf of findAll(answer, "musicCarouselShelfRenderer")) {
    const title = textOf(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title);
    const s = sorted(itemsOf(shelf));
    if (s.tracks.length + s.albums.length + s.artists.length + s.playlists.length) out.push({ title, ...s });
  }
  return out;
}

export async function home() {
  let answer = await call("browse", { browseId: "FEmusic_home" });
  const sections = sectionsOf(answer);
  // Home comes a few shelves at a time.
  for (let i = 0; i < 3; i++) {
    const token = continuationOf(answer.contents ? find(answer.contents, "sectionListRenderer") : answer.continuationContents);
    if (!token) break;
    answer = await call("browse", { continuation: token });
    sections.push(...sectionsOf(answer.continuationContents || answer));
  }
  return { sections };
}

const searchParams = {
  tracks: "EgWKAQIIAWoQEAUQCRAEEAMQChAVEBAQDg%3D%3D",
  albums: "EgWKAQIYAWoQEAUQCRAEEAMQChAVEBAQDg%3D%3D",
  artists: "EgWKAQIgAWoQEAUQCRAEEAMQChAVEBAQDg%3D%3D",
  playlists: "EgeKAQQoADgBahAQBRAJEAQQAxAKEBUQEBAO",
};

// Where the next page of a search starts: the app asks by offset, YouTube by token.
const pages = new Map();

export async function search({ query, kind = "tracks", offset = 0 }) {
  const params = searchParams[kind];
  if (!params) return {};
  const key = `${kind}\u0001${query}`;
  let answer, shelf;
  if (!offset) {
    answer = await call("search", { query, params: decodeURIComponent(params) });
    shelf = find(answer, "musicShelfRenderer") || {};
  } else {
    const token = pages.get(`${key}\u0001${offset}`);
    if (!token) return {};
    answer = await call("search", { continuation: token });
    shelf = answer.continuationContents?.musicShelfContinuation || find(answer, "musicShelfRenderer") || {};
  }
  const s = sorted(itemsOf(shelf));
  const count = s[kind].length;
  const next = continuationOf({ c: shelf.continuations });
  if (next && count) pages.set(`${key}\u0001${offset + count}`, next);
  return { [kind]: s[kind], more: !!(next && count) };
}

export async function suggest({ query }) {
  const answer = await call("music/get_search_suggestions", { input: query });
  return findAll(answer, "searchSuggestionRenderer").map((s) => textOf(s.suggestion)).filter(Boolean).slice(0, 10);
}

export async function album({ id }) {
  const answer = await call("browse", { browseId: id });
  const head = find(answer, "musicResponsiveHeaderRenderer") || find(answer, "musicDetailHeaderRenderer") || {};
  const image = imageOf(head.thumbnail);
  const artists = creditsOf(runsOf(head.straplineTextOne)).artists;
  if (!artists.length) {
    const name = textOf(head.straplineTextOne);
    if (name) artists.push({ id: "", name });
  }
  const info = { id, name: textOf(head.title), imageUrl: image, artists, released: yearOf(textOf(head.subtitle)) };
  const shelf = find(answer, "musicShelfRenderer") || {};
  const tracks = (shelf.contents || [])
    .map((c) => c.musicResponsiveListItemRenderer && trackOfRow(c.musicResponsiveListItemRenderer, { artists, album: { id, name: info.name }, image }))
    .filter(Boolean);
  return { album: info, tracks };
}

export async function artist({ id }) {
  const answer = await call("browse", { browseId: id });
  const head = find(answer, "musicImmersiveHeaderRenderer") || find(answer, "musicVisualHeaderRenderer") || {};
  const info = { id, name: textOf(head.title), imageUrl: imageOf(head.thumbnail) };
  const shelf = find(answer, "musicShelfRenderer");
  const tracks = shelf
    ? (shelf.contents || [])
        .map((c) => c.musicResponsiveListItemRenderer && trackOfRow(c.musicResponsiveListItemRenderer, { artists: [{ id, name: info.name }] }))
        .filter(Boolean)
    : [];
  const albums = [];
  for (const car of findAll(answer, "musicCarouselShelfRenderer")) {
    for (const it of itemsOf(car)) if (it?.kind === "album" && !albums.some((a) => a.id === it.value.id)) albums.push(it.value);
  }
  return { artist: info, tracks, albums };
}

export async function playlist({ id }) {
  const browseId = id.startsWith("VL") ? id : "VL" + id;
  let answer = await call("browse", { browseId });
  const head = find(answer, "musicResponsiveHeaderRenderer") || find(answer, "musicDetailHeaderRenderer") || {};
  const description = textOf(find(answer, "musicDescriptionShelfRenderer")?.description);
  const rows = [];
  let shelf = find(answer, "musicPlaylistShelfRenderer") || {};
  let more = shelf.contents || [];
  // Long playlists come 100 tracks at a time; stop at 1000.
  for (let page = 0; ; page++) {
    for (const c of more) {
      const r = c.musicResponsiveListItemRenderer;
      const tr = r && trackOfRow(r);
      if (tr) rows.push(tr);
    }
    const token = continuationOf({ a: shelf.continuations, b: more[more.length - 1]?.continuationItemRenderer });
    if (!token || page >= 9) break;
    answer = await call("browse", { continuation: token });
    shelf = answer.continuationContents?.musicPlaylistShelfContinuation || {};
    more = shelf.contents || find(answer, "continuationItems") || [];
  }
  const count = textOf(head.secondSubtitle).match(/[\d,]+/);
  return {
    id,
    name: textOf(head.title),
    imageUrl: imageOf(head.thumbnail),
    description,
    owner: textOf(head.straplineTextOne) || "",
    trackCount: count ? Number(count[0].replace(/,/g, "")) : rows.length,
    tracks: rows,
  };
}

// ── Lyrics ──

export async function lyrics({ id }) {
  const next = await call("next", { videoId: id });
  const tab = findAll(next, "tabRenderer").find((tr) => browseIdOf(tr.endpoint).startsWith("MPLY"));
  // An unselectable lyrics tab means YouTube has none for this track.
  if (!tab || tab.unselectable) return {};
  const answer = await call("browse", { browseId: browseIdOf(tab.endpoint) }, "android");
  const timed = find(answer, "timedLyricsData");
  if (!timed?.length) return {};
  return {
    lines: timed.map((l) => ({
      start: Number(l.cueRange?.startTimeMilliseconds || 0),
      end: Number(l.cueRange?.endTimeMilliseconds || 0),
      text: l.lyricLine === "♪" ? "" : l.lyricLine || "",
    })),
  };
}

// ── Audio ──

// Addresses last a few hours; keep each until a little before it says it ends.
const streams = new Map();

function gainOf(audio) {
  const lufs = audio?.trackAbsoluteLoudnessLkfs ?? audio?.perceptualLoudnessDb;
  return typeof lufs === "number" && lufs ? Math.round((-18 - lufs) * 100) / 100 : 0;
}

async function probeStream(url, headers) {
  try {
    const res = await fetch(url, { method: "HEAD", headers });
    return res.ok;
  } catch {
    return false;
  }
}

async function visionStream(id, quality, refreshVisitor = false) {
  const v = await ensurePlayerVisitor(refreshVisitor);
  const answer = await post("player", { videoId: id, contentCheckOk: true, racyCheckOk: true }, clients.vision(v));
  const status = answer.playabilityStatus || {};
  if (status.status !== "OK") {
    if (status.status === "LOGIN_REQUIRED") return null;
    throw fail("unavailable", status.reason || t("YouTube can't play this track"));
  }
  const audio = (answer.streamingData?.adaptiveFormats || []).filter(
    (f) => f.url && f.mimeType?.startsWith("audio/") && !f.isDrc && (!f.audioTrack || f.audioTrack.audioIsDefault),
  );
  if (!audio.length) throw fail("unavailable", t("YouTube listed no audio for this track"));
  audio.sort((a, b) => a.bitrate - b.bitrate);
  const f = quality === "standard" ? audio[0] : audio[audio.length - 1];
  const headers = { "user-agent": visionUA };
  if (!(await probeStream(f.url, headers))) return null;
  const expire = Number(new URL(f.url).searchParams.get("expire") || 0) * 1000;
  return {
    stream: {
      url: f.url,
      type: f.mimeType.includes("webm") ? "webm" : "m4a",
      quality,
      bitRate: f.averageBitrate || f.bitrate || 0,
      size: Number(f.contentLength || 0),
      gain: gainOf(answer.playerConfig?.audioConfig),
      headers,
    },
    until: (expire || Date.now() + 3600e3) - 600e3,
  };
}

export async function stream({ id, quality = "high" }) {
  const key = `${id}\u0001${quality}`;
  const known = streams.get(key);
  if (known && known.until > Date.now()) return known.stream;

  // Try visionOS with the current in-memory visitor id; if YouTube rejects it
  // (403 on HEAD or LOGIN_REQUIRED), rotate to a fresh visitor id once before
  // falling back to yt-dlp.
  let got = await visionStream(id, quality, false);
  if (!got) {
    playerVisitor = "";
    playerVisitorUntil = 0;
    got = await visionStream(id, quality, true);
  }
  if (got) {
    streams.set(key, got);
    return got.stream;
  }

  const found = await throughYtdlp(id, quality);
  streams.set(key, { stream: found, until: Date.now() + 3600e3 });
  return found;
}

// ── yt-dlp ──
// When YouTube asks this visit to sign in, yt-dlp, installed by the user, finds
// the audio as YouTube's website does. The app has to be allowed to start it
// (Settings → plugins). It gets the session's cookies on its standard input, as
// a cookie file, so they never show in the program's arguments or on disk.

const botCheck = () =>
  t("YouTube asked to confirm this isn't a bot, so it gave no audio. YouTube often asks this of VPN and proxy addresses: try another network or proxy node.");

function start(command, args) {
  try {
    return host.spawn(command, args);
  } catch (e) {
    const msg = String(e.message || e);
    if (/not allowed/.test(msg)) throw fail("setup", `${botCheck()} ${t("Or allow YouTube Music to run programs in Settings, to find the audio with yt-dlp.")}`);
    if (/not found/.test(msg)) throw fail("setup", `${botCheck()} ${t("Or install yt-dlp (brew install yt-dlp), to find the audio with it.")}`);
    throw e;
  }
}

// The session's cookies as a Netscape cookie file, which is how yt-dlp knows it's
// signed in (a Cookie header alone is sent, but yt-dlp doesn't sign requests with it).
function cookieFile() {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const part of cookie().split(";")) {
    const i = part.indexOf("=");
    const name = part.slice(0, i).trim();
    if (i > 0 && name && !/[\t\n]/.test(part)) lines.push([".youtube.com", "TRUE", "/", "TRUE", "2147483647", name, part.slice(i + 1).trim()].join("\t"));
  }
  return lines.join("\n") + "\n";
}

async function throughYtdlp(id, quality) {
  const signedIn = !!cookie();
  // 774 and 141 (about 256 kbps) are YouTube Premium's; others get 251 or 140.
  const format = quality === "standard" ? "140/251/bestaudio" : "774/141/251/140/bestaudio";
  const args = [
    ...(signedIn ? ["--cookies", "/dev/stdin"] : ["--extractor-args", "youtube:skip=hls,dash"]),
    "--format", format,
    "--no-warnings", "--no-playlist", "--no-progress", "--no-cache-dir",
    // yt-dlp needs a JavaScript runtime for YouTube; it uses whichever of these is installed.
    "--js-runtimes", "deno", "--js-runtimes", "node", "--js-runtimes", "bun",
    "--print", "%(.{url,http_headers,ext,abr})j",
    `https://music.youtube.com/watch?v=${id}`,
  ];
  const proc = start("yt-dlp", args);
  if (signedIn) proc.write(cookieFile());
  proc.closeStdin();
  const timer = setTimeout(() => proc.kill(), 40000);
  const lines = [];
  for (let l; (l = await proc.readLine()) !== null; ) if (l.trim()) lines.push(l);
  const code = await proc.wait();
  clearTimeout(timer);
  // On the way out yt-dlp tries to save the cookies back to the cookie file,
  // which is its standard input, and fails; what it printed before still counts.
  let f;
  try {
    f = JSON.parse(lines[lines.length - 1]);
  } catch {}
  if (!f?.url) throw ytdlpError(proc.errorOutput(), signedIn, code);
  return {
    url: f.url,
    type: f.ext || "",
    quality,
    bitRate: Math.round((f.abr || 0) * 1000),
    headers: f.http_headers || {},
  };
}

function ytdlpError(output, signedIn, code) {
  const last = output.split("\n").reverse().find((l) => l.startsWith("ERROR:")) || output.trim().split("\n").pop() || "";
  const why = last.replace(/^ERROR:\s*(\[[^\]]*\]\s*)?(\S+:\s*)?/, "");
  if (/not a bot|sign in|cookies/i.test(why)) {
    return fail("signIn", signedIn ? t("YouTube turned down your session: sign in again") : `${botCheck()} ${t("Or sign in to YouTube Music in Settings.")}`);
  }
  if (/unavailable|private|removed|not available|premium/i.test(why)) return fail("unavailable", why);
  return new Error(`yt-dlp: ${why || `stopped (${code})`}`);
}

// ── Account ──

const signInPage =
  "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=" +
  encodeURIComponent("https://www.youtube.com/signin?action_handle_signin=true&next=https%3A%2F%2Fmusic.youtube.com%2F");

// Google won't sign in a page it takes for one inside an app.
const safariUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

export async function signIn() {
  const { cookie: c } = await host.webSignIn({
    url: signInPage,
    cookiesOf: site,
    until: ["SAPISID", "__Secure-3PSID"],
    userAgent: safariUA,
  });
  host.storage.set("cookie", c);
  const me = await account();
  if (!me) {
    host.storage.remove("cookie");
    throw new Error(t("YouTube Music didn't take that sign-in: try again"));
  }
  return me;
}

export function signOut() {
  host.storage.remove("cookie");
}

export async function account() {
  if (!cookie()) return null;
  const answer = await call("account/account_menu", {});
  const head = find(answer, "activeAccountHeaderRenderer");
  if (!head) return null;
  const name = textOf(head.accountName);
  return { id: textOf(head.channelHandle) || name, name, imageUrl: imageOf(head.accountPhoto) };
}

export async function liked({ offset = 0 } = {}) {
  if (!cookie()) throw fail("signIn");
  if (offset) return { tracks: [], more: false };
  const p = await playlist({ id: "LM" });
  return { tracks: p.tracks, more: false };
}
