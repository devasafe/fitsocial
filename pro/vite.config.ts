import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 5175: o app roda em 8081, o painel administrativo em 5174. Portas fixas e
// distintas para os tres poderem subir juntos numa maquina so.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  build: { outDir: "dist", sourcemap: false },
});
