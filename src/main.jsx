import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import ThemeToaster from "./components/ThemeToaster.jsx";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ClusterProvider } from "./context/ClusterContext.jsx";
import { DEFAULT_THEME, THEME_STORAGE_KEY, ThemeProvider } from "./context/ThemeContext.jsx";
import "./styles.css";
import { queryClient, queryPersistOptions } from "./lib/queryClient";

const rootElement = window.document.documentElement;
let initialTheme = DEFAULT_THEME;
try {
  initialTheme = window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : DEFAULT_THEME;
} catch {
  initialTheme = DEFAULT_THEME;
}
rootElement.dataset.theme = initialTheme;
rootElement.dataset.appearance = initialTheme;
rootElement.style.colorScheme = initialTheme;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
        <AuthProvider>
          <ThemeProvider>
            <ClusterProvider>
              <App />
            </ClusterProvider>
            <ThemeToaster />
          </ThemeProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
