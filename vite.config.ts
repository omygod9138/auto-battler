import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/** Short commit hash of the build, or "unknown" outside a git checkout. */
function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

// GitHub Pages serves the site from /<repo>/.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/auto-battler/" : "/",
  // Shown in the page corner so a deploy can be matched to its commit.
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
