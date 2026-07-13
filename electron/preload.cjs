const { contextBridge } = require('electron');

// Exposes a minimal, safe API to the renderer (window.corelyn).
// Extend this as native needs come up (e.g. serial/USB access for the
// onboard link, local mission file storage, auto-update status, etc.)
contextBridge.exposeInMainWorld('corelyn', {
  isElectron: true,
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
