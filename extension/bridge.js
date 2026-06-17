// Runs only on Breeze pages. Listens for a profile pushed from the Breeze app
// via window.postMessage and saves it into the extension's storage as the
// active profile. No portal credentials, no scraping — the app hands us the
// data deliberately when the user clicks "Send to Autofill".
(function () {
  function genId() {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  window.addEventListener('message', async (event) => {
    // Only accept messages from this same page (the Breeze app), not iframes.
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'breeze-autofill' || msg.type !== 'profile') return;
    const data = msg.profile;
    if (!data || typeof data !== 'object') return;

    const label = data.fullName || data.email || 'Profile';
    let { profiles, activeId } = await chrome.storage.local.get(['profiles', 'activeId']);
    if (!Array.isArray(profiles)) profiles = [];

    // Replace an existing profile with the same name/email, else add.
    const key = (data.fullName || '') + '|' + (data.email || '');
    const existing = profiles.find(
      (p) => ((p.data.fullName || '') + '|' + (p.data.email || '')) === key && key !== '|'
    );
    let id;
    if (existing) {
      existing.label = label;
      existing.data = data;
      id = existing.id;
    } else {
      id = genId();
      profiles.unshift({ id, label, data });
    }
    await chrome.storage.local.set({ profiles, activeId: id });

    // Acknowledge so the app can confirm it landed.
    window.postMessage({ source: 'breeze-autofill', type: 'ack', label }, '*');
  });

  // Let the app know the extension is present (optional, for a nicer UX).
  window.postMessage({ source: 'breeze-autofill', type: 'ready' }, '*');
})();
