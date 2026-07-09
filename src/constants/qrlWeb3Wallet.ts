export const APP_INDEX_FILE = "index.html";
// Full-tab / expanded view. The `?tab=true` marker lets the renderer detect the
// tab context deterministically (the action popup loads bare `index.html`, the
// side panel uses `?sidepanel=true`), so popup sizing no longer relies on a
// fragile first-paint viewport measurement.
export const APP_TAB_FILE = "index.html?tab=true";
