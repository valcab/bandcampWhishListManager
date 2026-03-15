const statusNode = document.getElementById("status");
const albumCard = document.getElementById("album-card");
const resultsNode = document.getElementById("results");
const searchButton = document.getElementById("search-btn");
const coverNode = document.getElementById("cover");
const albumTitleNode = document.getElementById("album-title");
const albumArtistNode = document.getElementById("album-artist");
const RESULT_LIMIT = 6;
const REFRESH_INTERVAL_MS = 1200;

let metadata = null;
let currentAlbumKey = "";
let refreshTimer = null;

initialize().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

searchButton.addEventListener("click", () => {
  if (!metadata) {
    return;
  }

  searchMatches(metadata).catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error));
  });
});

async function initialize() {
  resetPopupState("Open a Spotify album page to get started.");
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.url || !isSpotifyAlbumUrl(tab.url)) {
    resetPopupState("Open a Spotify album page, then click the extension again.");
    return;
  }

  await refreshFromTab(tab);
  startAutoRefresh();
}

async function refreshFromTab(tab) {
  const nextMetadata = await extractSpotifyMetadata(tab);

  if (!nextMetadata?.album || !nextMetadata?.artist) {
    resetPopupState("I found the Spotify album page, but not enough metadata to search Bandcamp.");
    return;
  }

  const nextAlbumKey = `${nextMetadata.album}::${nextMetadata.artist}`.toLowerCase();
  if (currentAlbumKey && currentAlbumKey !== nextAlbumKey) {
    clearResults();
  }

  metadata = nextMetadata;
  currentAlbumKey = nextAlbumKey;
  renderAlbum(metadata);
  searchButton.disabled = false;
  setStatus("Ready. Search Bandcamp and add the best match to your wishlist.");
}

function startAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }

  refreshTimer = window.setInterval(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tab?.id || !tab.url || !isSpotifyAlbumUrl(tab.url)) {
        if (metadata || currentAlbumKey) {
          resetPopupState("Open a Spotify album page, then click the extension again.");
        }
        return;
      }

      const nextMetadata = await extractSpotifyMetadata(tab);
      const nextAlbumKey = `${nextMetadata?.album ?? ""}::${nextMetadata?.artist ?? ""}`.toLowerCase();
      if (!nextAlbumKey || nextAlbumKey === currentAlbumKey) {
        return;
      }

      await refreshFromTab(tab);
    } catch {}
  }, REFRESH_INTERVAL_MS);
}

async function extractSpotifyMetadata(tab) {
  const livePageContext = await getLiveSpotifyPageContext(tab.id);
  const liveUrl = livePageContext?.url || tab.url;
  const fromOEmbed = await extractFromOEmbed(liveUrl);

  return {
    album: livePageContext?.album || fromOEmbed?.album || "",
    artist: livePageContext?.artist || fromOEmbed?.artist || "",
    coverUrl: livePageContext?.coverUrl || fromOEmbed?.coverUrl || ""
  };
}

async function extractFromOEmbed(url) {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const parsed = parseSpotifyTitle(data.title ?? "");
    const album = parsed.album || "";
    const artist = data.author_name?.trim() || parsed.artist || "";

    if (!album || !artist) {
      return null;
    }

    return {
      album,
      artist,
      coverUrl: data.thumbnail_url ?? ""
    };
  } catch {
    return null;
  }
}

async function getLiveSpotifyPageContext(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const firstNonEmpty = (...values) => values.find((value) => Boolean(value && value.trim()))?.trim() ?? "";
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? "";
      const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name)?.trim() ?? "";
      const textFrom = (root, selector) => root?.querySelector(selector)?.textContent?.trim() ?? "";
      const closest = (node, selector) => node?.closest(selector) ?? null;

      const parseArtistFromDescription = (description) => {
        const patterns = [
          /Album\s*[·-]\s*(.*?)\s*[·-]\s*\d{4}/i,
          /Album\s+by\s+(.+?)(?:\s*[·-]\s*|$)/i,
          /Album\s+par\s+(.+?)(?:\s*[·-]\s*|$)/i
        ];

        for (const pattern of patterns) {
          const match = description.match(pattern);
          if (match?.[1]?.trim()) {
            return match[1].trim();
          }
        }

        return "";
      };
      const cleanSpotifySuffix = (value) => value.replace(/\s*\|\s*Spotify$/i, "").trim();
      const parseTitleLine = (value) => {
        const cleaned = cleanSpotifySuffix(value);
        const patterns = [
          /^(.*?)\s*-\s*Album\s+by\s+(.+)$/i,
          /^(.*?)\s*-\s*Album\s+par\s+(.+)$/i,
          /^(.*?)\s*-\s*(.+?)\s*$/i
        ];

        for (const pattern of patterns) {
          const match = cleaned.match(pattern);
          if (match?.[1]?.trim()) {
            return {
              album: match[1].trim(),
              artist: match[2]?.trim() ?? ""
            };
          }
        }

        return { album: cleaned, artist: "" };
      };
      const parseJsonLd = () => {
        const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent ?? "{}");
            const nodes = Array.isArray(data) ? data : [data];
            for (const node of nodes) {
              const byArtist = node?.byArtist;
              const artistName = Array.isArray(byArtist)
                ? byArtist.map((entry) => entry?.name).find(Boolean)
                : byArtist?.name ?? "";
              const albumName = node?.name ?? "";
              if (albumName || artistName) {
                return {
                  album: albumName.trim(),
                  artist: artistName.trim()
                };
              }
            }
          } catch {}
        }

        return { album: "", artist: "" };
      };
      const albumHeading =
        document.querySelector('main h1') ||
        document.querySelector('[data-testid="entityTitle"]') ||
        document.querySelector("h1");
      const albumHeader =
        closest(albumHeading, '[data-testid="entityHeader"]') ||
        closest(albumHeading, "section") ||
        closest(albumHeading, "main") ||
        document.querySelector("main");
      const titleNodeText = firstNonEmpty(albumHeading?.textContent ?? "", text('[data-testid="entityTitle"]'));
      const ogTitle = attr('meta[property="og:title"]', "content");
      const twitterTitle = attr('meta[name="twitter:title"]', "content");
      const ogDescription = attr('meta[property="og:description"]', "content");
      const twitterDescription = attr('meta[name="twitter:description"]', "content");
      const pageImage = firstNonEmpty(
        attr('[data-testid="entityHeader"] img', "src"),
        attr('[data-testid="entityHeader"] img', "srcset").split(",")[0]?.trim().split(" ")[0] ?? "",
        attr('main img[alt]', "src"),
        attr('img[src*="i.scdn.co/image/"]', "src")
      );
      const ogImage = firstNonEmpty(
        pageImage,
        attr('meta[property="og:image"]', "content"),
        attr('meta[name="twitter:image"]', "content")
      );
      const titleInfo = parseTitleLine(firstNonEmpty(document.title, ogTitle, twitterTitle));
      const jsonLd = parseJsonLd();
      const pageArtistCandidates = [
        textFrom(albumHeader, '[data-testid="creator-link"]'),
        textFrom(albumHeader, 'a[data-testid="creator-link"]'),
        textFrom(albumHeader, 'a[href*="/artist/"]'),
        textFrom(albumHeader, 'span a'),
        textFrom(albumHeader, 'a')
      ].filter(Boolean);
      const artistLinks = [...document.querySelectorAll('main a[href*="/artist/"]')]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);

      const album = firstNonEmpty(
        titleNodeText,
        titleInfo.album,
        cleanSpotifySuffix(ogTitle),
        cleanSpotifySuffix(twitterTitle),
        jsonLd.album
      );
      const artist = firstNonEmpty(
        pageArtistCandidates[0],
        artistLinks[0],
        textFrom(albumHeader, '[data-testid="entitySubTitle"] a'),
        titleInfo.artist,
        parseArtistFromDescription(firstNonEmpty(ogDescription, twitterDescription)),
        jsonLd.artist
      );

      return {
        url: window.location.href,
        album,
        artist,
        coverUrl: ogImage
      };
    }
  });

  return result;
}

function parseSpotifyTitle(value) {
  const cleaned = String(value ?? "").replace(/\s*\|\s*Spotify$/i, "").trim();
  const patterns = [
    /^(.*?)\s*-\s*Album\s+by\s+(.+)$/i,
    /^(.*?)\s*-\s*Album\s+par\s+(.+)$/i,
    /^(.*?)\s*-\s*(.+?)\s*$/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]?.trim()) {
      return {
        album: match[1].trim(),
        artist: match[2]?.trim() ?? ""
      };
    }
  }

  return { album: cleaned, artist: "" };
}

function renderAlbum(details) {
  albumCard.classList.remove("hidden");
  albumTitleNode.textContent = details.album;
  albumArtistNode.textContent = details.artist;
  coverNode.alt = `${details.album} cover`;
  if (details.coverUrl) {
    coverNode.src = details.coverUrl;
    coverNode.classList.remove("cover-fallback");
  } else {
    coverNode.removeAttribute("src");
    coverNode.classList.add("cover-fallback");
  }
}

function hideAlbum() {
  albumCard.classList.add("hidden");
  albumTitleNode.textContent = "";
  albumArtistNode.textContent = "";
  coverNode.removeAttribute("src");
  coverNode.alt = "";
  coverNode.classList.remove("cover-fallback");
}

async function searchMatches(details) {
  searchButton.disabled = true;
  setStatus("Searching Bandcamp...");
  resultsNode.classList.add("hidden");
  resultsNode.replaceChildren();

  const matches = await findBandcampMatches(details);

  if (!matches.length) {
    setStatus("No Bandcamp album matches found for this release.");
    searchButton.disabled = false;
    return;
  }

  const topMatch = matches[0];
  const quickAdd = document.createElement("button");
  quickAdd.className = "primary";
  quickAdd.type = "button";
  quickAdd.textContent = `Quick add best match (${topMatch.score}%)`;
  quickAdd.addEventListener("click", () => openAndWishlist(topMatch));

  resultsNode.appendChild(quickAdd);

  for (const result of matches) {
    resultsNode.appendChild(renderResult(result));
  }

  resultsNode.classList.remove("hidden");
  setStatus("Review the matches or quick-add the best one.");
  searchButton.disabled = false;
}

function renderResult(result) {
  const wrapper = document.createElement("article");
  wrapper.className = "result";

  const image = document.createElement("img");
  image.alt = "";
  image.src = result.art || "";
  wrapper.appendChild(image);

  const body = document.createElement("div");
  const score = document.createElement("p");
  score.className = "match-score";
  score.textContent = `Match ${result.score}%`;
  body.appendChild(score);

  const title = document.createElement("h3");
  title.textContent = result.title;
  body.appendChild(title);

  const artist = document.createElement("p");
  artist.textContent = result.artist;
  body.appendChild(artist);

  if (result.label) {
    const label = document.createElement("p");
    label.textContent = result.label;
    body.appendChild(label);
  }

  const addButton = document.createElement("button");
  addButton.className = "secondary";
  addButton.type = "button";
  addButton.textContent = "Open and wishlist";
  addButton.addEventListener("click", () => openAndWishlist(result));
  body.appendChild(addButton);

  wrapper.appendChild(body);
  return wrapper;
}

async function openAndWishlist(result) {
  if (!metadata) {
    return;
  }

  setStatus(`Opening ${result.title} on Bandcamp...`);
  await chrome.tabs.create({
    url: withBridgeHash(result.url, metadata),
    active: true
  });

  window.close();
}

function setStatus(message) {
  statusNode.textContent = message;
}

function clearResults() {
  resultsNode.classList.add("hidden");
  resultsNode.replaceChildren();
  searchButton.disabled = true;
}

function resetPopupState(message) {
  metadata = null;
  currentAlbumKey = "";
  hideAlbum();
  clearResults();
  setStatus(message);
}

coverNode.addEventListener("error", () => {
  coverNode.removeAttribute("src");
  coverNode.classList.add("cover-fallback");
});

function isSpotifyAlbumUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "open.spotify.com") {
      return false;
    }

    return /^\/(?:intl-[^/]+\/)?album\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

async function findBandcampMatches(details) {
  const queries = [
    [details.artist, details.album].filter(Boolean).join(" "),
    details.album,
    `${asciiFold(details.artist)} ${details.album}`.trim()
  ].filter(Boolean);

  const allResults = [];
  for (const query of [...new Set(queries)]) {
    const url = `https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=a`;
    const response = await fetch(url, { credentials: "omit" });

    if (!response.ok) {
      throw new Error(`Bandcamp search failed with ${response.status}.`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const queryResults = [...doc.querySelectorAll(".result-items li.searchresult, li.searchresult")]
      .map((node) => extractResult(node, details))
      .filter(Boolean);

    allResults.push(...queryResults);
  }

  return [...dedupeResults(allResults)]
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT);
}

function extractResult(node, metadata) {
  const headingLink = node.querySelector(".heading a, .itemurl");
  if (!headingLink?.href) {
    return null;
  }

  const title = text(node.querySelector(".heading"));
  if (!title) {
    return null;
  }

  const typeText = [
    text(node.querySelector(".type")),
    text(node.querySelector(".itemtype")),
    text(node.querySelector(".subhead"))
  ].join(" ");

  if (/(track|song)/i.test(typeText) && !/album/i.test(typeText)) {
    return null;
  }

  const subhead = text(node.querySelector(".subhead"));
  const artist = text(node.querySelector(".subhead > a")) || subhead.replace(/^by\s+/i, "");
  const label = text(node.querySelector(".itemsubtext"));
  const art = node.querySelector("img")?.src ?? "";
  const score = scoreMatch(metadata, { title, artist, url: headingLink.href });

  return {
    url: headingLink.href,
    title,
    artist,
    label,
    art,
    score
  };
}

function withBridgeHash(url, details) {
  const hashPayload = new URLSearchParams({
    bcwlm: "1",
    artist: details.artist ?? "",
    album: details.album ?? ""
  });
  const cleanUrl = url.split("#")[0];
  return `${cleanUrl}#${hashPayload.toString()}`;
}

function scoreMatch(source, candidate) {
  const titleScore = combinedFieldScore(source.album, candidate.title);
  const artistScore = combinedFieldScore(source.artist, candidate.artist);
  const slugBonus = scoreSlugMatch(source.artist, candidate.url);
  return Math.round((titleScore * 0.65 + artistScore * 0.25 + slugBonus * 0.1) * 100);
}

function similarity(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);

  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let shared = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }

  return (2 * shared) / (leftSet.size + rightSet.size);
}

function combinedFieldScore(left, right) {
  const normalizedLeft = normalizeForComparison(left);
  const normalizedRight = normalizeForComparison(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.96;
  }

  const leftCompact = compactForComparison(left);
  const rightCompact = compactForComparison(right);
  if (leftCompact && rightCompact && leftCompact === rightCompact) {
    return 0.98;
  }

  const tokenScore = similarity(left, right);
  const orderedBonus = hasOrderedTokenRun(tokenize(left), tokenize(right)) ? 0.12 : 0;
  return Math.min(1, tokenScore + orderedBonus);
}

function tokenize(value) {
  return normalizeForComparison(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function asciiFold(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeForComparison(value) {
  return asciiFold(String(value ?? ""))
    .replace(/[()[\]{}]/g, " ")
    .replace(/\b(the|a|an|ep|lp|album|single|remaster(?:ed)?|deluxe|edition)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactForComparison(value) {
  return normalizeForComparison(value).replace(/\s+/g, "");
}

function hasOrderedTokenRun(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) {
    return false;
  }

  const rightJoined = rightTokens.join(" ");
  const leftJoined = leftTokens.join(" ");
  return rightJoined.includes(leftJoined) || leftJoined.includes(rightJoined);
}

function scoreSlugMatch(artist, url) {
  try {
    const hostname = new URL(url).hostname;
    const subdomain = hostname.split(".")[0] ?? "";
    const slug = asciiFold(artist).replace(/[^\p{L}\p{N}]+/gu, "");
    const candidate = asciiFold(subdomain).replace(/[^\p{L}\p{N}]+/gu, "");
    return slug && candidate && (candidate.includes(slug) || slug.includes(candidate)) ? 1 : 0;
  } catch {
    return 0;
  }
}

function dedupeResults(results) {
  const byUrl = new Map();
  for (const result of results) {
    const existing = byUrl.get(result.url);
    if (!existing || result.score > existing.score) {
      byUrl.set(result.url, result);
    }
  }

  return byUrl.values();
}

function text(node) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
