import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, storedTheme } from "./lib/theme";
import { applyLang, storedLang } from "./i18n";

// Apply the saved theme and language before the first paint (no flash of the defaults).
applyTheme(storedTheme());
applyLang(storedLang());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
