import React from "react";
import { createRoot } from "react-dom/client";
import AiNgPage from "./AiNgPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AiNgPage />
  </React.StrictMode>
);
