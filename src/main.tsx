// Buffer polyfill for browser environment (required by Ledger libraries)
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './i18n'
// Brand fonts, self-hosted (MV3 CSP forbids remote fonts). Explicit
// /index.css paths so vite rewrites the package-relative woff2 URLs.
import '@fontsource-variable/sora/index.css'
import '@fontsource-variable/instrument-sans/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import './index.css'

// Chrome sizes the action popup from the document's intrinsic size.
// index.html pins html/body to height:100% + overflow:hidden (the
// double-scrollbar fix), which leaves the document without an intrinsic
// height, so the popup opens collapsed to a sliver: the 600px wallet
// container is exactly the overflow being hidden. Pin an explicit pixel
// height on the popup surface only; the side panel and expanded tab
// (marked ?sidepanel= / ?tab=, same markers as settingsStore) own their
// viewport and keep the 100% chain. Width stays unpinned: the body
// min-width in index.html already gives the popup its intrinsic width,
// and a hard body width squeezes the wallet container's scrollbar
// gutter into a horizontal scrollbar.
const surfaceParams = new URLSearchParams(window.location.search);
if (!surfaceParams.has('sidepanel') && !surfaceParams.has('tab')) {
  document.documentElement.style.setProperty('height', '600px', 'important');
  document.body.style.setProperty('height', '600px', 'important');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
