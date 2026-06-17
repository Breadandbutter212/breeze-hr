// Minimal service worker. Seeds empty storage on install so the popup has
// a predictable shape to read.
chrome.runtime.onInstalled.addListener(async () => {
  const { profiles } = await chrome.storage.local.get('profiles');
  if (!Array.isArray(profiles)) {
    await chrome.storage.local.set({ profiles: [], activeId: null });
  }
});
