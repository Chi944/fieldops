import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.FIELDOPS_PERSONAL_MODE === "true" && !process.env.VERCEL ? ".fieldops/personal-next" : ".next",
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "tesseract.js", "sharp", "exceljs"],
  poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
  ] }]; }
};
export default config;
