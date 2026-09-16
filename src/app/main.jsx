import React from "react";
import ReactDOM from "react-dom/client";
import Pokemon30App from "./features/pokemon30/Pokemon30App";
import { startReleaseGuard } from "./utils/release-guard";

startReleaseGuard();
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Pokemon30App />
  </React.StrictMode>,
);
