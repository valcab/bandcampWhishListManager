const SETTINGS_KEY = "popup_settings_v1";

export async function getSettings(defaults) {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return {
    ...defaults,
    ...(result[SETTINGS_KEY] ?? {})
  };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: settings
  });
}
