import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ClusterProvider } from "./context/ClusterContext.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ClusterProvider>
          <App />
        </ClusterProvider>
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
