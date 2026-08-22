import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// El proyecto ya declaraba @vitejs/plugin-react como dependencia pero no existía
// configuración: sin ella no hay Fast Refresh y cada cambio recargaba la página entera
// perdiendo el estado del backoffice.
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["favicon.svg", "pwa-icon.svg"],
    manifest: {
      name: "AUTHENTIQ · Operación de showroom",
      short_name: "AUTHENTIQ",
      description: "Inventario, clientes, citas y cotizaciones para tu concesionario.",
      theme_color: "#101212",
      background_color: "#101212",
      display: "standalone",
      start_url: "/",
      icons: [{ src: "/pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    },
  })],
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
