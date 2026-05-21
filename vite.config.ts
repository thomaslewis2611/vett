// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import rehypeSlug from "rehype-slug";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      (() => {
        const mdxPlugin = mdx({
          remarkPlugins: [remarkGfm, remarkFrontmatter, [remarkMdxFrontmatter, { name: "frontmatter" }]],
          rehypePlugins: [rehypeSlug],
        }) as { transform?: (this: unknown, code: string, id: string) => unknown; [k: string]: unknown };
        return {
          enforce: "pre" as const,
          ...mdxPlugin,
          async transform(code: string, id: string) {
            // Skip query-param imports (e.g. ?raw) so Vite's built-in handlers take over.
            if (id.includes("?")) return null;
            return (mdxPlugin.transform as ((this: unknown, code: string, id: string) => unknown) | undefined)?.call(this, code, id);
          },
        };
      })(),
    ],
  },
});
