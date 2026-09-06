import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Deployment and preview plumbing only — no game or simulation code is involved.
 *
 * ### Base path (GitHub Pages)
 * A GitHub Pages *project* site is served from `https://<user>.github.io/<repo>/`, so a bundle
 * deployed there has to emit base-prefixed asset URLs; mounted at `/` instead, the page loads an
 * empty `<div id="root">` and 404'd JS. `PAGES_BASE` is the single knob: `npm run build:pages`
 * sets it to `/game-studio-tycoon/` and the Pages workflow deploys exactly that build. Everything
 * without the variable — `npm run build`, `npm run dev`, `npm run preview` — stays mounted at `/`,
 * so local development and Arena's proxied preview are untouched. `PAGES_BASE=/` builds for a user
 * site root or a custom domain.
 *
 * The app has no client-side router (screens are selected in state, not by URL), so a base path is
 * all that hosting needs: there are no deep links to rewrite and no absolute asset URLs in the
 * source to fix up.
 *
 * ### Dev-client tags in preview mode
 * Arena's live preview reaches this server through a reverse proxy at
 * `https://{port}-{sandboxId}.e2b.app`, which is not guaranteed to upgrade the `vite-hmr`
 * websocket. When Vite's HMR socket cannot stay open, the injected client retries
 * `wss://localhost:5173` — the *viewer's own machine* — and then reload-polls the page, which is
 * what a "server is up but the preview won't open" report looks like from the outside.
 * `server.hmr: false` alone does not fix that, because the client script is still injected into
 * index.html and still runs its reconnect loop. (`appType: 'custom'` is worse: it stops Vite
 * serving index.html at all, so `/` 404s.) So `npm run dev:preview` serves the ordinary dev module
 * graph with the injected dev-client tags removed: same app, same on-demand transforms, no
 * websocket to fail over. Plain `npm run dev` keeps hot reload.
 */
const previewMode = process.env.ARENA_PREVIEW === '1';

/**
 * Mount point for the built app. Unset — the default, and what every local flow uses — means `/`;
 * `npm run build:pages` and the Pages workflow set it to the Pages project path.
 */
const base = process.env.PAGES_BASE ?? '/';

/** Drops the injected HMR client / react-refresh tags so the browser never opens a dev socket. */
function stripDevClientTags(): Plugin {
  return {
    name: 'arena-preview-strip-dev-client',
    apply: 'serve',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<script type="module"[^>]*src="\/@(vite\/client|react-refresh)"[^>]*><\/script>/g, '')
        .replace(/\s*<script type="module">[^<]*(?:injectIntoGlobalHook|\$RefreshReg\$)[\s\S]*?<\/script>/g, '');
    },
  };
}

export default defineConfig({
  // Set only by `build:pages` / the Pages workflow; every local flow stays at '/'.
  base,
  plugins: [react(), ...(previewMode ? [stripDevClientTags()] : [])],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The preview reaches us under a generated host, so the host check stays off.
    allowedHosts: true,
    // Nothing here is origin-bound: the app only ever requests relative URLs, so a rejected
    // preflight would just look like a broken game.
    cors: true,
    hmr: previewMode ? false : undefined,
    headers: previewMode ? { 'Cache-Control': 'no-cache' } : undefined,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
