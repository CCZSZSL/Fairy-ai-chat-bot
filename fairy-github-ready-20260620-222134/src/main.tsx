import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installMockBridge } from "./mockBridge";
import "./styles.css";

installMockBridge();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
