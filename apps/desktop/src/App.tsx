import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type MenuInfo = {
  topLevelKeys: number;
  normalizedSample: string;
};

type AuthEnvStatus = {
  beEmailSet: boolean;
  bePasswordSet: boolean;
  upliftEmailSet: boolean;
  upliftPasswordSet: boolean;
};

export default function App() {
  const [status, setStatus] = useState("未取得");
  const [authStatus, setAuthStatus] = useState("未確認");

  const fetchMenu = async () => {
    setStatus("取得中...");
    try {
      const info = await invoke<MenuInfo>("fetch_bbsmenu_summary");
      setStatus(`ok keys=${info.topLevelKeys} sample=${info.normalizedSample}`);
    } catch (error) {
      setStatus(`error: ${String(error)}`);
    }
  };

  const checkAuthEnv = async () => {
    try {
      const s = await invoke<AuthEnvStatus>("check_auth_env_status");
      setAuthStatus(
        `BE(email:${s.beEmailSet}, pass:${s.bePasswordSet}) UPLIFT(email:${s.upliftEmailSet}, pass:${s.upliftPasswordSet})`
      );
    } catch (error) {
      setAuthStatus(`error: ${String(error)}`);
    }
  };

  return (
    <main className="app-root">
      <h1>5ch Browser (Phase 0)</h1>
      <p>Live5ch geronimo互換UIの基盤を準備中です。</p>
      <button onClick={fetchMenu}>bbsmenu.json 取得テスト</button>
      <pre>{status}</pre>
      <button onClick={checkAuthEnv}>BE/UPLIFT 設定確認</button>
      <pre>{authStatus}</pre>
    </main>
  );
}
