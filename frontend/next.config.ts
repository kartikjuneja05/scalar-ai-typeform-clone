import type { NextConfig } from "next";
const apiUrl = (process.env.API_URL || "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);
const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};
export default config;
