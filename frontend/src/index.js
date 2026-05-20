// Sentry must be initialised before React renders
import "./sentry";

import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./lib/queryClient";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    {/*
      Provider order matters:
        1. QueryClientProvider  — must be outermost data layer
        2. AuthProvider         — reads localStorage, manages token state
        3. SocketProvider       — depends on AuthContext (isAuthenticated)
        4. App                  — routing + pages
    */}
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <App />
        </SocketProvider>
      </AuthProvider>
      {/* Devtools only rendered in development builds */}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  </React.StrictMode>,
);
