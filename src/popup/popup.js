const statusNode = document.getElementById("status");
const albumCard = document.getElementById("album-card");
const resultsNode = document.getElementById("results");
const searchButton = document.getElementById("search-btn");
const coverNode = document.getElementById("cover");
const albumTitleNode = document.getElementById("album-title");
const albumArtistNode = document.getElementById("album-artist");
const RESULT_LIMIT = 6;

let metadata = null;

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
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.url || !/^https:\/\/open\.spotify\.com\/album\//.test(tab.url)) {
    setStatus("Open a Spotify album page, then click the extension again.");
    return;
  }

  metadata = await extractFromTab(tab.id);

  if (!metadata?.album || !metadata?.artist) {
    setStatus("I found the Spotify album page, but not enough metadata to search Bandcamp.");
    return;
  }

  renderAlbum(metadata);
  searchButton.disabled = false;
  setStatus("Ready. Search Bandcamp and add the best match to your wishlist.");
}

async function extractFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const parseArtistFromDescription = (description) => {
        const match = description.match(/Album\s*[·-]\s*(.*?)\s*[·-]\s*\d{4}/i);
        return match?.[1]?.trim() ?? "";
      };
      const cleanAlbumTitle = (title) => title.replace(/\s*\|\s*Spotify$/i, "").trim();
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content ?? "";
      const ogDescription = document.querySelector('meta[property="og:description"]')?.content ?? "";
      const ogImage = document.querySelector('meta[property="og:image"]')?.content ?? "";
      const titleNode = document.querySelector("h1");
      const artistNode = document.querySelector('[data-testid="entitySubTitle"] a, [href^="/artist/"]');
      const album = titleNode?.textContent?.trim() || cleanAlbumTitle(ogTitle);
      const artist = artistNode?.textContent?.trim() || parseArtistFromDescription(ogDescription);

      return {
        album,
        artist,
        coverUrl: ogImage
      };
    }
  });

  return result;
}

function renderAlbum(details) {
  albumCard.classList.remove("hidden");
  albumTitleNode.textContent = details.album;
  albumArtistNode.textContent = details.artist;
  coverNode.src = details.coverUrl || "";
  coverNode.alt = `${details.album} cover`;
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

async function findBandcampMatches(details) {
  const query = [details.artist, details.album].filter(Boolean).join(" ");
  const url = `https://bandcamp.com/search?q=${encodeURIComponent(query)}&item_type=a`;
  const response = await fetch(url, { credentials: "omit" });

  if (!response.ok) {
    throw new Error(`Bandcamp search failed with ${response.status}.`);
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  return [...doc.querySelectorAll(".result-items li.searchresult, li.searchresult")]
    .map((node) => extractResult(node, details))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT);
}

function extractResult(node, metadata) {
  const headingLink = node.querySelector(".heading a, .itemurl");
  if (!headingLink?.href) {
    return null;
  }

  const subhead = text(node.querySelector(".subhead"));
  if (!/album/i.test(subhead)) {
    return null;
  }

  const title = text(node.querySelector(".heading"));
  const artist = text(node.querySelector(".subhead > a")) || subhead.replace(/^by\s+/i, "");
  const label = text(node.querySelector(".itemsubtext"));
  const art = node.querySelector("img")?.src ?? "";
  const score = scoreMatch(metadata, { title, artist });

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
  const titleScore = similarity(source.album, candidate.title);
  const artistScore = similarity(source.artist, candidate.artist);
  return Math.round((titleScore * 0.6 + artistScore * 0.4) * 100);
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
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function text(node) {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
