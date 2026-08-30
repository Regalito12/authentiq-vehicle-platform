import { QueryClient } from "@tanstack/react-query";

// Cache corto para lecturas del panel: evita peticiones duplicadas al cambiar
// de módulo, pero no deja datos operativos congelados durante mucho tiempo.
// Las mutaciones invalidan este espacio desde Backoffice antes de recargar.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 120_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});
