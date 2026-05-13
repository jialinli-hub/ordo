import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  ...(mode === "test" && {
    define: {
      /** Vitest 下内联 env；避免本机 .env 绝对地址 + Solid effect 叠出「Workspace 空」假失败 */
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify("")
    }
  }),
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
}));
