/** Commit hash and ISO time of the build, injected by vite.config.ts. */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** Supabase project URL; with the key below, turns on the online leaderboard. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase publishable (anon) key; safe to ship in the client. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
