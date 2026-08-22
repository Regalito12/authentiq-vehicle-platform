import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El proyecto ya declaraba @vitejs/plugin-react como dependencia pero no existía
// configuración: sin ella no hay Fast Refresh y cada cambio recargaba la página entera
// perdiendo el estado del backoffice.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El catálogo usa rutas reales (/vehiculos/...). El fallback SPA de Vite ya las cubre en
    // desarrollo; en producción hay que configurarlo en el servidor estático (ver DEPLOYMENT-CHECKLIST.md).
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts")) return "charts-vendor";
          if (id.includes("@tanstack")) return "tables-vendor";
          if (id.includes("motion")) return "motion-vendor";
          return undefined;
        },
      },
    },
  },
});
