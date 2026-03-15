export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

export function isSpotifyAlbumUrl(rawUrl) {
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

export async function extractSpotifyMetadata(tab) {
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
        document.querySelector("main h1") ||
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
        attr("main img[alt]", "src"),
        attr('img[src*="i.scdn.co/image/"]', "src")
      );
      const fallbackImage = firstNonEmpty(
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
        textFrom(albumHeader, "span a"),
        textFrom(albumHeader, "a")
      ].filter(Boolean);
      const artistLinks = [...document.querySelectorAll('main a[href*="/artist/"]')]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);

      return {
        url: window.location.href,
        album: firstNonEmpty(
          titleNodeText,
          titleInfo.album,
          cleanSpotifySuffix(ogTitle),
          cleanSpotifySuffix(twitterTitle),
          jsonLd.album
        ),
        artist: firstNonEmpty(
          pageArtistCandidates[0],
          artistLinks[0],
          textFrom(albumHeader, '[data-testid="entitySubTitle"] a'),
          titleInfo.artist,
          parseArtistFromDescription(firstNonEmpty(ogDescription, twitterDescription)),
          jsonLd.artist
        ),
        coverUrl: fallbackImage
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

export async function findBandcampMatches(details, resultLimit = 6) {
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
    .slice(0, resultLimit);
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

  return {
    url: headingLink.href,
    title,
    artist,
    label,
    art,
    score: scoreMatch(metadata, { title, artist, url: headingLink.href })
  };
}

function scoreMatch(source, candidate) {
  const titleScore = combinedFieldScore(source.album, candidate.title);
  const artistScore = combinedFieldScore(source.artist, candidate.artist);
  const slugBonus = scoreSlugMatch(source.artist, candidate.url);
  return Math.round((titleScore * 0.65 + artistScore * 0.25 + slugBonus * 0.1) * 100);
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
