import { fileURLToPath, URL } from "node:url";

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  output: "standalone",
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; form-action 'self'; base-uri 'self'" },
    ] }];
  },
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  transpilePackages: [
    "@pvp/shared",
    "@pvp/config",
    "@pvp/pipeline",
    "@pvp/rules",
    "@pvp/source",
    "@pvp/ingest",
    "@pvp/card",
  ],
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "pg"],
  webpack(webpackConfig) {
    // Keep native bindings out of webpack even while sibling packages have an older
    // version pending integration. The web host pins and traces patched runtimes.
    webpackConfig.externals.push({
      sharp: "commonjs sharp",
      "@resvg/resvg-js": "commonjs @resvg/resvg-js",
    });
    // Workspace packages use NodeNext-style .js specifiers for TypeScript sources.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return webpackConfig;
  },
  outputFileTracingIncludes: {
    "/api/card/*": [
      "../../packages/card/assets/**/*",
      "../../packages/card/fonts/**/*",
      "../../node_modules/.pnpm/@resvg+*/node_modules/@resvg/**/*",
    ],
    "/*": [
      "../../node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
      "../../node_modules/.pnpm/@img+*/node_modules/@img/**/*",
    ],
  },
};
export default config;
