import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Preview plumbing only — no game or simulation code is involved.
 *
 * Arena's live preview reaches this server through a reverse proxy at
 * `https://{port}-{sandboxId}.e2b.app`, which is not guaranteed to upgrade the `vite-hmr`
 * websocket. That matters more than it sounds: when Vite's HMR socket cannot stay open, the
 * injected client retries `wss://localhost:5173` — the *viewer's own machine* — and then
 * reload-polls the page, which is exactly what a "server is up but the preview won't open"
 * report looks like from the outside. `server.hmr: false` alone does not fix that, because the
 * client script is still injected into index.html and still runs its reconnect loop. (`appType:
 * 'custom'` is worse: it stops Vite serving index.html at all, so `/` 404s.)
 *
 * So `npm run dev:preview` (sets `ARENA_PREVIEW=1`) serves the ordinary dev module graph with the
 * injected dev-client tags removed: same app, same on-demand transforms, no websocket to fail
 * over. Plain `npm run dev` keeps hot reload for local work, and `npm run preview` (built assets,
 * which contain no dev client by construction) is the static alternative.
 */
const previewMode = process.env.ARENA_PREVIEW === '1';

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

/**
 * `allowedHosts: true` because the preview hostname is generated per sandbox session, and CORS
 * stays permissive: the app only ever fetches relative URLs, so there is nothing origin-bound to
 * protect, and a rejected preflight would just look like a broken game.
 */
export default defineConfig({
  plugins: [react(), ...(previewMode ? [stripDevClientTags()] : [])],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
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
