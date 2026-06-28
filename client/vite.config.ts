import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web: base "/v-editor/" (sottocartella di mininno.com).
// Electron (ELECTRON=1): base "./" per caricare gli asset da file:// nel bundle.
export default defineConfig({
  base: process.env.ELECTRON ? "./" : "/v-editor/",
  build: {
    outDir: process.env.ELECTRON ? "dist-electron" : "dist",
  },
  plugins: [react()],
  server: { port: 5173 },
});
