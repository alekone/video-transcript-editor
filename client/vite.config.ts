import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/v-editor/" perché l'app è servita dalla sottocartella di mininno.com.
// In dev resta "/v-editor/" così i path combaciano con la produzione.
export default defineConfig({
  base: "/v-editor/",
  plugins: [react()],
  server: { port: 5173 },
});
