import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/auto-battler/" : "/",
});
