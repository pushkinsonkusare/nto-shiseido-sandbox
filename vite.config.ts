import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/nto-shiseido-sandbox/" : "/",
  plugins: [react()],
  build: {
    /* Output to /docs so legacy GitHub Pages can serve it directly
     * from `main` branch with Source: /docs (no Actions needed). */
    outDir: "docs",
    emptyOutDir: true,
  },
  server: {
    /* Pin host + port so HMR has one stable socket to talk to. */
    host: "localhost",
    port: 5173,
    /* Fail fast on `npm run dev` if 5173 is already taken instead of
     * silently picking 5174/5175/etc. — that's how stale Vite
     * instances were piling up and getting OOM-killed by the OS. */
    strictPort: true,
    hmr: {
      /* The full-page error overlay swallowed transient CSS errors
       * and made it look like the server was dead. Keep errors in
       * the terminal where they're recoverable. */
      overlay: false,
    },
    watch: {
      /* Ignore anything Vite shouldn't be re-scanning on every save.
       * `public/**` is intentionally broad — public assets are
       * served as-is and don't need HMR; the 171 MB
       * Dji_product_images directory in particular can spike memory
       * if the watcher ever falls back to a deep scan. */
      ignored: [
        "**/.git/**",
        "**/.cache/**",
        "**/.vite/**",
        "**/coverage/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/public/**",
      ],
    },
  },
}));
