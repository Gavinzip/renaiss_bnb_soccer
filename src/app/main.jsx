import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./ticket-source.css";
import App from "./App";
import { startReleaseGuard } from "./utils/release-guard";

startReleaseGuard();
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
