import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// https://vite.dev/config/
export default defineConfig({
  plugins: [solid({ hot: !process.env.VITEST })],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_PROXY_API || "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  },
  build: {
    target: "esnext"
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.js"
  }
});
