  function installRecorderDevHotReload() {
    const manifest = chrome.runtime.getManifest();
    const versionName = String(manifest.version_name || "");
    const manifestName = String(manifest.name || "");
    if (versionName !== "dev" && !versionName.endsWith("-dev") && !manifestName.endsWith("Dev")) {
      return;
    }
    const manifestUrl = "http://127.0.0.1:8792/captura-dev-manifest.json";
    let lastMtimeMs = 0;
    window.setInterval(() => {
      fetch(`${manifestUrl}?t=${Date.now()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((devManifest) => {
          const nextMtimeMs = Number(devManifest && (devManifest.latestMtimeMs || devManifest.builtAtMs));
          if (!nextMtimeMs) return;
          if (!lastMtimeMs) {
            lastMtimeMs = nextMtimeMs;
            return;
          }
          if (nextMtimeMs > lastMtimeMs) {
            chrome.runtime.sendMessage({ type: "LWR_DEV_RELOAD", reason: "dev-manifest-changed" });
          }
        })
        .catch(() => {
          // Dev server may be offline; keep Recorder usable.
        });
    }, 1500);
  }

  installRecorderDevHotReload();
