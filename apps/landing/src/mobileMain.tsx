import React from "react";
import { createRoot } from "react-dom/client";
import MobilePages, { type MobilePageKey } from "./MobilePages";
import "./styles.css";

const page = (document.body.dataset.page || "mobile") as MobilePageKey;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobilePages page={page} />
  </React.StrictMode>
);
