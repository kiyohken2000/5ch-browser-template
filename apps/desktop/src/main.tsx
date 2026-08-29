import React from "react";
import ReactDOM from "react-dom/client";
import App, { bootstrapUiJson } from "./App";
import "./styles.css";

const render = () =>
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

// data/*.json に置いた UI 状態を localStorage へ流し込んでから描画する。
// 失敗しても localStorage 側の副本で起動できるので、描画自体は必ず行う。
void bootstrapUiJson().catch((e) => console.warn("bootstrapUiJson failed", e)).then(render);
