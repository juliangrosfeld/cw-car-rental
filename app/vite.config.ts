import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import {
  higgsfieldDesignInspectorVitePlugin,
  higgsfieldDesignSourceBabelPlugin,
} from "./src/module/design-inspector/vite";
import svgr from "vite-plugin-svgr";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// The vendored @higgsfield/quanta components import their glyphs from the private
// Nexus-only `@higgsfield-ai/icons`. Generated sites build on the PUBLIC npm
// registry, so we redirect every `@higgsfield-ai/icons/*` import to a Material
// Symbols shim instead (see src/lib/quanta-material-icons.ts). tsconfig.json has
// the matching `paths` entry so type-checking resolves it too.
const QUANTA_ICONS_SHIM = fileURLToPath(
  new URL("./src/lib/quanta-material-icons.ts", import.meta.url),
);

/**
 * Deploy target. Vercel is the default because Vercel's zero-config build runs
 * a bare `vite build` and cannot set this variable — the default therefore has
 * to be the one a CI with no env config should produce.
 *
 * `DEPLOY_TARGET=cloudflare` restores the original Higgsfield/Workers build
 * (Workers-shaped `export default { fetch }` bundle + fully-inlined SSR deps).
 * That path is kept intact but is no longer the default; see NOTES below.
 */
const DEPLOY_TARGET = process.env.DEPLOY_TARGET === "cloudflare" ? "cloudflare" : "vercel";

export default defineConfig(({ mode, command }) => {
  const designInspectorEnabled = process.env.HF_DESIGN_INSPECTOR === "1" || mode === "design";
  const isCloudflare = DEPLOY_TARGET === "cloudflare";

  // Vite only exposes VITE_-prefixed vars to the browser, but the project's
  // canonical names for these are unprefixed (SUPABASE_URL / SUPABASE_ANON_KEY
  // in .env and in the Vercel dashboard). Rather than force a duplicate set of
  // VITE_ vars, the two PUBLIC values are mapped across explicitly below.
  //
  // Done as an allowlist of exactly two keys — NOT via `envPrefix: "SUPABASE_"`,
  // which is a prefix match and would sweep SUPABASE_SERVICE_ROLE_KEY into the
  // browser bundle along with them. Never widen this to a prefix.
  //
  // The third argument "" makes loadEnv return unprefixed vars too. An explicit
  // VITE_-prefixed value still wins if one is set.
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const publicSupabaseEnv = {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
    ),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? "",
    ),
  };

  return {
    define: publicSupabaseEnv,
    resolve: {
      alias: [{ find: /^@higgsfield-ai\/icons(\/.*)?$/, replacement: QUANTA_ICONS_SHIM }],
    },
    // CLOUDFLARE ONLY. The Workers server bundle has no node_modules at
    // runtime: Vite's default SSR build leaves npm deps as bare external
    // imports (h3, react, @tanstack/*, seroval, …), which resolve on a Node
    // server but throw "No such module" in a Worker, so they get bundled in.
    // (node: builtins stay external — nodejs_compat provides them.)
    // Build only: in `vite dev` the SSR module runner would inline react's
    // CJS entry and crash ("module is not defined").
    //
    // On Vercel the opposite is true — the function runs on Node with a real
    // node_modules, so inlining everything only bloats the bundle and breaks
    // packages that expect to be external. Nitro handles externals itself.
    ssr: isCloudflare
      ? {
          noExternal: command === "build" ? true : undefined,
          // `cloudflare:workers` is a workerd runtime built-in exposing the
          // Worker env / bindings. Like node: builtins it must NOT be bundled.
          external: ["cloudflare:workers"],
        }
      : undefined,
    build: isCloudflare
      ? {
          // Keep `cloudflare:*` external in the SSR rollup pass too — `noExternal`
          // above would otherwise try to resolve+bundle it and fail.
          rollupOptions: { external: [/^cloudflare:/] },
        }
      : undefined,
    plugins: [
      // Material Symbols SVGs (the app icon set) import as React components via
      // `?react`. `icon: true` sizes them 1em; fill is forced to currentColor so
      // they color like text (the raw SVGs have no fill attribute). Keep the
      // viewBox so CSS sizing scales the glyph.
      svgr({
        svgrOptions: {
          icon: true,
          svgProps: { fill: "currentColor" },
          svgoConfig: {
            plugins: [
              { name: "preset-default", params: { overrides: { removeViewBox: false } } },
            ],
          },
        },
      }),
      // TanStack Start plugin must run before React's plugin.
      //
      // VERCEL (default): the custom server entry is deliberately NOT passed.
      // src/server.ts is a Workers-shaped `export default { fetch(req, env, ctx) }`
      // handler; on Vercel, Nitro owns the server entry and produces the Vercel
      // Function itself. The SSR error-page fallback that entry provided is
      // already covered for server functions by the request middleware in
      // src/start.ts.
      //
      // CLOUDFLARE: `vite build` emits the Workers-shaped server bundle
      // (dist/server/server.js) plus dist/client (hashed static assets), which
      // the platform publishes as a per-tenant Worker at <sub>.higgsfield.app/.
      //
      // Either way rendering happens on the server per request, so site code
      // must be SSR-safe: never touch browser-only globals (window, document,
      // localStorage, navigator) during render or at module top level — only
      // inside effects/handlers, or guarded with `typeof window !== "undefined"`.
      tanstackStart(isCloudflare ? { server: { entry: "server" } } : {}),
      // Nitro builds the Vercel output (.vercel/output). Vercel's zero-config
      // detection picks it up with no build command or output directory set.
      // Omitted on the Cloudflare path, where the hand-rolled Workers entry
      // above is the server instead.
      ...(isCloudflare ? [] : [nitro()]),
      higgsfieldDesignInspectorVitePlugin(designInspectorEnabled),
      react({
        babel: {
          plugins: designInspectorEnabled ? [higgsfieldDesignSourceBabelPlugin] : [],
        },
      }),
      tailwindcss(),
      tsconfigPaths(),
    ],
  };
});
