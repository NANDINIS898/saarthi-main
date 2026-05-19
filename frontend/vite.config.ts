import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Forward all backend calls so the React app can use relative URLs
      // and avoid CORS headaches during local development.
      "/auth":         { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/users":        { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/kyc":          { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/health":       { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/applications": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/assistant":    { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
