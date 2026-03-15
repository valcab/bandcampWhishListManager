(async () => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (params.get("bcwlm") !== "1") {
    return;
  }

  const artist = params.get("artist") ?? "";
  const album = params.get("album") ?? "";
  showToast(`Trying to add "${album}" by ${artist} to your Bandcamp wishlist...`);

  await waitForReady();

  const status = attemptWishlistClick();
  if (status === "clicked") {
    showToast("Wishlist button clicked. If Bandcamp asks you to log in, finish that step and click again.");
    clearBridgeHash();
    return;
  }

  if (status === "already") {
    showToast("This release already looks wishlisted.");
    clearBridgeHash();
    return;
  }

  showToast("I could not find the wishlist button automatically. Open the album page and click it manually.");
})();

async function waitForReady() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (findWishlistControl()) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
}

function attemptWishlistClick() {
  const control = findWishlistControl();
  if (!control) {
    return "missing";
  }

  const label = readLabel(control);
  if (/(in wishlist|wishlisted|added)/i.test(label)) {
    return "already";
  }

  control.click();
  return "clicked";
}

function findWishlistControl() {
  const wishlistMessage = document.getElementById("wishlist-msg");
  if (wishlistMessage) {
    const clickableParent = wishlistMessage.closest("button, a, span, div");
    if (clickableParent) {
      return clickableParent;
    }

    return wishlistMessage;
  }

  const selectors = [
    ".fav-track-or-album",
    ".wishlist-button",
    "[data-bind*='wishlist']",
    "button",
    "a"
  ];

  for (const selector of selectors) {
    const nodes = [...document.querySelectorAll(selector)];
    const control = nodes.find((node) => /(wishlist|wantlist)/i.test(readLabel(node)));
    if (control) {
      return control;
    }
  }

  return null;
}

function readLabel(node) {
  return [
    node.id,
    node.getAttribute("aria-label"),
    node.getAttribute("title"),
    node.textContent
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function clearBridgeHash() {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function showToast(message) {
  let toast = document.getElementById("bcwlm-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "bcwlm-toast";
    toast.style.position = "fixed";
    toast.style.bottom = "16px";
    toast.style.right = "16px";
    toast.style.zIndex = "2147483647";
    toast.style.maxWidth = "320px";
    toast.style.padding = "12px 14px";
    toast.style.borderRadius = "12px";
    toast.style.background = "rgba(18, 20, 24, 0.92)";
    toast.style.color = "#f7f1e8";
    toast.style.font = "600 13px/1.4 system-ui, sans-serif";
    toast.style.boxShadow = "0 16px 40px rgba(0, 0, 0, 0.25)";
    document.documentElement.appendChild(toast);
  }

  toast.textContent = message;
}
