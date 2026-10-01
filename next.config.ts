import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // blob: is required for the interview widget's AudioWorklet (mic processing
  // runs from a blob: module the SDK generates at runtime, not a real file).
  `script-src 'self' 'unsafe-inline' blob:${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' https:", // call recordings are served by the voice provider
  // The in-browser interview opens a WebSocket straight to OmniDimension's voice
  // gateway from the candidate's browser (the exact host isn't a stable contract
  // per OmniDimension's own docs, so this allows any omnidim.io subdomain).
  "connect-src 'self' https://*.omnidim.io wss://*.omnidim.io",
  // Belt-and-suspenders with the blob: in script-src above — browsers are not
  // fully consistent about which directive governs AudioWorklet module loading.
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["mammoth", "unpdf"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // microphone=(self): the in-browser AI interview needs mic access on our own
          // pages. Still blocked for any cross-origin iframe, and camera/geolocation/
          // payment stay fully blocked since nothing in the app uses them.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
