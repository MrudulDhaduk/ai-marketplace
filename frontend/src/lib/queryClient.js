/**
 * queryClient.js — Centralized TanStack Query client configuration
 *
 * Single source of truth for all cache/stale time defaults.
 * Import `queryClient` wherever you need direct cache access
 * (e.g. socket invalidation handlers).
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds — avoids redundant refetches
      // when the same query is mounted by multiple components simultaneously.
      staleTime: 30 * 1000,

      // Keep unused cache entries for 5 minutes before garbage-collecting.
      gcTime: 5 * 60 * 1000,

      // Retry failed requests once before surfacing the error.
      retry: 1,

      // Do not refetch on window focus by default — socket events handle
      // realtime freshness. Individual queries can override this.
      refetchOnWindowFocus: false,

      // Refetch on reconnect so stale data is recovered after a network blip.
      refetchOnReconnect: true,
    },
    mutations: {
      // Surface mutation errors to the component — no silent swallowing.
      throwOnError: false,
    },
  },
});
