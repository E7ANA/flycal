import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5273,
    proxy: {
      "/api": {
        target: "http://localhost:8200",
        changeOrigin: true,
        timeout: 600000, // 10 minutes — solver can take a while
      },
    },
  },
});
