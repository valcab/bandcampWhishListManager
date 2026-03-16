import React, { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Globe, Info, LoaderCircle, Palette, Search } from "lucide-react";
import { Button } from "./components/ui/button.jsx";
import { Card } from "./components/ui/card.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select.jsx";
import { Spinner } from "./components/ui/spinner.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.jsx";
import { getSettings, saveSettings } from "./lib/storage.js";
import { extractSpotifyMetadata, findBandcampMatches, getActiveTab, isSpotifyAlbumUrl } from "./lib/extension.js";

const DEFAULT_SETTINGS = {
  language: "en",
  theme: "bandcamp",
  resultCount: "6"
};

const COPY = {
  en: {
    appTitle: "Bandcamp Wishlist Bridge",
    appSubtitle: "A cleaner popup for tracking the current Spotify album and opening the closest Bandcamp release.",
    matchesTab: "Matches",
    settingsTab: "Settings",
    noAlbumTitle: "Waiting for a Spotify album page",
    noAlbumBody: "Open a Spotify album page in the active tab and this popup will detect it automatically.",
    missingAlbum: "I found the Spotify page, but not enough album metadata to search Bandcamp.",
    inactivePage: "Open a Spotify album page to get started.",
    detecting: "Reading the current Spotify album...",
    searching: "Searching Bandcamp...",
    ready: "Bandcamp matches ready.",
    noMatches: "No Bandcamp album matches found for this release.",
    opening: "Opening Bandcamp release...",
    albumLabel: "Album",
    openBest: "Open best match",
    openBandcamp: "Open on Bandcamp",
    openBestWithScore: "Open best match",
    statusReady: "Ready",
    language: "Language",
    languageHint: "Pick the popup language for labels and helper text.",
    theme: "Theme",
    themeHint: "Switch the popup palette without affecting Spotify or Bandcamp.",
    resultCount: "Result count",
    resultCountHint: "Choose how many Bandcamp matches to display for each album.",
    english: "English",
    french: "Français",
    spotify: "Spotify",
    bandcamp: "Bandcamp",
    graphite: "Graphite",
    footer: "Some searches can take a moment, so the popup now keeps a live loader visible while it works."
  },
  fr: {
    appTitle: "Bandcamp Wishlist Bridge",
    appSubtitle: "Un popup plus propre pour suivre l'album Spotify courant et ouvrir la meilleure page Bandcamp.",
    matchesTab: "Correspondances",
    settingsTab: "Réglages",
    noAlbumTitle: "En attente d'une page album Spotify",
    noAlbumBody: "Ouvre une page album Spotify dans l'onglet actif et le popup la détectera automatiquement.",
    missingAlbum: "La page Spotify est bien ouverte, mais les métadonnées de l'album sont insuffisantes.",
    inactivePage: "Ouvre une page album Spotify pour commencer.",
    detecting: "Lecture de l'album Spotify en cours...",
    searching: "Recherche sur Bandcamp...",
    ready: "Correspondances Bandcamp prêtes.",
    noMatches: "Aucun album Bandcamp trouvé pour cette sortie.",
    opening: "Ouverture de la page Bandcamp...",
    albumLabel: "Album",
    openBest: "Ouvrir le meilleur résultat",
    openBandcamp: "Ouvrir sur Bandcamp",
    openBestWithScore: "Ouvrir le meilleur résultat",
    statusReady: "Prêt",
    language: "Langue",
    languageHint: "Choisis la langue des libellés et aides du popup.",
    theme: "Thème",
    themeHint: "Change l'ambiance visuelle du popup sans modifier Spotify ou Bandcamp.",
    resultCount: "Nombre de résultats",
    resultCountHint: "Définis combien de résultats Bandcamp afficher pour chaque album.",
    english: "English",
    french: "Français",
    spotify: "Spotify",
    bandcamp: "Bandcamp",
    graphite: "Graphite",
    footer: "Certaines recherches prennent un peu de temps, donc le popup garde maintenant un indicateur visible pendant le chargement."
  }
};

export function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState("matches");
  const [album, setAlbum] = useState(null);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState({ tone: "neutral", text: COPY.en.inactivePage });
  const [phase, setPhase] = useState("idle");
  const [openingUrl, setOpeningUrl] = useState("");
  const albumKeyRef = useRef("");
  const refreshLockRef = useRef(false);
  const searchKeyRef = useRef("");

  const t = COPY[settings.language] ?? COPY.en;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await getSettings(DEFAULT_SETTINGS);
      if (!cancelled) {
        setSettings(stored);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (refreshLockRef.current || cancelled) {
        return;
      }

      refreshLockRef.current = true;
      try {
        await refreshFromActiveTab();
      } finally {
        refreshLockRef.current = false;
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 1400);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [settings.resultCount, t.detecting, t.inactivePage, t.missingAlbum, t.noMatches, t.ready, t.searching]);

  async function refreshFromActiveTab() {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url || !isSpotifyAlbumUrl(tab.url)) {
      resetState({ text: t.inactivePage, tone: "warning" });
      return;
    }

    setPhase((current) => (current === "opening" ? current : "detecting"));
    setStatus({ tone: "neutral", text: t.detecting });

    const metadata = await extractSpotifyMetadata(tab);
    if (!metadata?.album || !metadata?.artist) {
      resetState({ text: t.missingAlbum, tone: "warning" });
      return;
    }

    const nextAlbumKey = `${metadata.album}::${metadata.artist}`.toLowerCase();
    const resultKey = `${nextAlbumKey}::${settings.resultCount}`;
    const albumChanged = albumKeyRef.current !== nextAlbumKey;

    setAlbum(metadata);
    if (albumChanged) {
      setMatches([]);
      albumKeyRef.current = nextAlbumKey;
      searchKeyRef.current = "";
    }

    if (searchKeyRef.current === resultKey) {
      setPhase("ready");
      setStatus({ tone: "success", text: t.ready });
      return;
    }

    await runSearch(metadata, nextAlbumKey, resultKey);
  }

  async function runSearch(metadata, expectedAlbumKey, resultKey) {
    setPhase("searching");
    setStatus({ tone: "neutral", text: t.searching });
    const results = await findBandcampMatches(metadata, Number(settings.resultCount));

    if (albumKeyRef.current !== expectedAlbumKey) {
      return;
    }

    setMatches(results);
    searchKeyRef.current = resultKey;
    setPhase("ready");
    setStatus({
      tone: results.length ? "success" : "warning",
      text: results.length ? t.ready : t.noMatches
    });
  }

  function resetState(nextStatus) {
    albumKeyRef.current = "";
    searchKeyRef.current = "";
    setAlbum(null);
    setMatches([]);
    setOpeningUrl("");
    setPhase("idle");
    setStatus(nextStatus);
  }

  async function updateSetting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveSettings(next);
  }

  async function openBandcampRelease(match) {
    setOpeningUrl(match.url);
    setPhase("opening");
    setStatus({ tone: "neutral", text: t.opening });
    await chrome.tabs.create({
      url: match.url,
      active: true
    });
    window.close();
  }

  const isBusy = phase === "detecting" || phase === "searching" || phase === "opening";
  const topMatch = matches[0];

  return (
    <div className="popup-shell">
      <header className="hero-card">
        <div className="hero-row hero-row-spread">
          <div className="brand-row">
            <div className="brand-mark">B</div>
            <div>
              <p className="eyebrow">Spotify to Bandcamp</p>
              <h1 className="title">{t.appTitle}</h1>
            </div>
          </div>
          <button className="icon-button" onClick={() => setActiveTab("settings")} type="button">
            <Info size={18} />
          </button>
        </div>
        <p className="subtitle">{t.appSubtitle}</p>
        <div style={{ marginTop: 14 }}>
          <span className={`status-pill ${status.tone}`}>
            {isBusy ? <Spinner /> : <Check size={14} />}
            {status.text}
          </span>
        </div>
      </header>

      <Tabs className="tabs-root" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="tabs-list">
          <TabsTrigger className="tabs-trigger" value="matches">
            <span>{t.matchesTab}</span>
            <span className="tab-badge">{matches.length}</span>
          </TabsTrigger>
          <TabsTrigger className="tabs-trigger" value="settings">
            {t.settingsTab}
          </TabsTrigger>
        </TabsList>

        <TabsContent className="tabs-content" value="matches">
          {album ? (
            <Card className="album-card">
              {album.coverUrl ? (
                <img alt={`${album.album} cover`} className="album-cover" src={album.coverUrl} />
              ) : (
                <div className="album-cover fallback" />
              )}
              <div>
                <p className="section-label">{t.albumLabel}</p>
                <h2 className="album-title">{album.album}</h2>
                <p className="album-artist">{album.artist}</p>
              </div>
            </Card>
          ) : (
            <Card className="empty-state">
              <h2 className="album-title">{t.noAlbumTitle}</h2>
              <p>{status.text || t.noAlbumBody}</p>
            </Card>
          )}

          <div className="result-stack" style={{ marginTop: 14 }}>
            {phase === "searching" ? (
              <div className="loader-blocks">
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
              </div>
            ) : null}

            {matches.map((match) => (
              <Card className="result-card" key={match.url}>
                <img alt="" src={match.art || ""} />
                <div>
                  <p className="match-score">{match.score}% match</p>
                  <h3 className="result-title">{match.title}</h3>
                  <p className="result-meta">{match.artist}</p>
                  {match.label ? <p className="result-meta">{match.label}</p> : null}
                  <div style={{ marginTop: 10 }}>
                    <Button
                      variant="secondary"
                      disabled={phase === "opening"}
                      onClick={() => openBandcampRelease(match)}
                    >
                      {phase === "opening" && openingUrl === match.url ? <LoaderCircle size={16} className="spin" /> : <ExternalLink size={16} />}
                      {t.openBandcamp}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent className="tabs-content" value="settings">
          <div className="setting-stack">
            <Card className="setting-row">
              <div>
                <p className="setting-label"><Globe size={12} style={{ verticalAlign: "text-top", marginRight: 6 }} />{t.language}</p>
                <p className="setting-copy">{t.languageHint}</p>
              </div>
              <Select value={settings.language} onValueChange={(value) => updateSetting("language", value)}>
                <SelectTrigger className="ui-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="ui-select-content">
                  <SelectItem className="ui-select-item" value="en">{t.english}</SelectItem>
                  <SelectItem className="ui-select-item" value="fr">{t.french}</SelectItem>
                </SelectContent>
              </Select>
            </Card>

            <Card className="setting-row">
              <div>
                <p className="setting-label"><Palette size={12} style={{ verticalAlign: "text-top", marginRight: 6 }} />{t.theme}</p>
                <p className="setting-copy">{t.themeHint}</p>
              </div>
              <Select value={settings.theme} onValueChange={(value) => updateSetting("theme", value)}>
                <SelectTrigger className="ui-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="ui-select-content">
                  <SelectItem className="ui-select-item" value="spotify">{t.spotify}</SelectItem>
                  <SelectItem className="ui-select-item" value="bandcamp">{t.bandcamp}</SelectItem>
                  <SelectItem className="ui-select-item" value="graphite">{t.graphite}</SelectItem>
                </SelectContent>
              </Select>
            </Card>

            <Card className="setting-row">
              <div>
                <p className="setting-label"><Search size={12} style={{ verticalAlign: "text-top", marginRight: 6 }} />{t.resultCount}</p>
                <p className="setting-copy">{t.resultCountHint}</p>
              </div>
              <Select value={settings.resultCount} onValueChange={(value) => updateSetting("resultCount", value)}>
                <SelectTrigger className="ui-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="ui-select-content">
                  <SelectItem className="ui-select-item" value="4">4</SelectItem>
                  <SelectItem className="ui-select-item" value="6">6</SelectItem>
                  <SelectItem className="ui-select-item" value="8">8</SelectItem>
                </SelectContent>
              </Select>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {topMatch ? (
        <div className="footer-action">
          <Button
            className="ui-button-primary ui-button-large"
            disabled={phase === "opening"}
            onClick={() => openBandcampRelease(topMatch)}
          >
            {phase === "opening" && openingUrl === topMatch.url ? <LoaderCircle size={18} className="spin" /> : <ExternalLink size={18} />}
            {t.openBest} ({topMatch.score}%)
          </Button>
        </div>
      ) : null}

      <p className="footer-note">{t.footer}</p>
    </div>
  );
}
