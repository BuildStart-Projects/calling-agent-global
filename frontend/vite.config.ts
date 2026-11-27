import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/** Public site URL: VITE_SITE_URL, else Vercel's production domain, else localhost. */
function siteUrl(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "");
  const raw = env.VITE_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:8080");
  return raw.replace(/\/$/, "");
}

/** Writes robots.txt + sitemap.xml and fills %SITE_URL% (canonical, og:url, og:image) at build time. */
function seo(mode: string): Plugin {
  const url = siteUrl(mode);
  const pages = ["/", "/terms", "/privacy"];
  return {
    name: "buildstart-seo",
    transformIndexHtml: { order: "pre", handler: (html) => html.replace(/%SITE_URL%/g, url) },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${url}${p === "/" ? "/" : p}</loc><lastmod>${today}</lastmod><priority>${p === "/" ? "1.0" : "0.3"}</priority></url>`).join("\n")}\n</urlset>\n` });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /admin\nDisallow: /auth\nDisallow: /reset-password\n\nSitemap: ${url}/sitemap.xml\n` });
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: { host: "::", port: 8080 },
  plugins: [react(), seo(mode)],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          motion: ["framer-motion"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}) as any);
