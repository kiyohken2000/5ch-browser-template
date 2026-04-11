import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthConfig, AuthEnvStatus, LoginOutcome } from "../types";
import { isTauriRuntime } from "../constants";

export function useAuth(setStatus: (s: string) => void) {
  const [authStatus, setAuthStatus] = useState("not checked");
  const [loginProbe, setLoginProbe] = useState("not run");
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    upliftEmail: "", upliftPassword: "", beEmail: "", bePassword: "", autoLoginBe: false, autoLoginUplift: false,
  });
  const [roninLoggedIn, setRoninLoggedIn] = useState(false);
  const [beLoggedIn, setBeLoggedIn] = useState(false);
  const [authSaveMsg, setAuthSaveMsg] = useState("");

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

  const probeAuth = async () => {
    setLoginProbe("running...");
    try {
      const result = await invoke<LoginOutcome[]>("probe_auth_logins");
      const lines = result.map(
        (r) =>
          `${r.provider}: success=${r.success} status=${r.status} location=${r.location ?? "-"} cookies=${
            r.cookieNames.join(",") || "(none)"
          }`
      );
      setLoginProbe(lines.join("\n"));
    } catch (error) {
      setLoginProbe(`error: ${String(error)}`);
    }
  };

  const doLogin = async (target?: "be" | "uplift") => {
    if (!isTauriRuntime()) return;
    const t = target ?? "all";
    setStatus(`ログイン中... (target=${t}, be=${authConfig.beEmail.length > 0}, uplift=${authConfig.upliftEmail.length > 0})`);
    try {
      // Save current config before login attempt
      await invoke("save_auth_config", { config: authConfig });
      const results = await invoke<LoginOutcome[]>("login_with_config", {
        target: t,
        beEmail: authConfig.beEmail,
        bePassword: authConfig.bePassword,
        upliftEmail: authConfig.upliftEmail,
        upliftPassword: authConfig.upliftPassword,
      });
      for (const r of results) {
        if (r.provider === "Be" && r.success) setBeLoggedIn(true);
        if (r.provider === "Be" && !r.success) setBeLoggedIn(false);
        if ((r.provider === "Uplift" || r.provider === "Donguri") && r.success) setRoninLoggedIn(true);
      }
      const details = results.map((r) => {
        if (r.success) return `${r.provider}:OK`;
        return `${r.provider}:NG(${r.note})`;
      });
      setStatus(details.length > 0 ? details.join(" | ") : "ログイン対象なし");
    } catch (error) {
      setStatus(`login error: ${String(error)}`);
    }
  };

  const doLogout = (provider: "ronin" | "be") => {
    if (provider === "ronin") {
      setRoninLoggedIn(false);
      setStatus("Ronin: ログアウト");
    } else {
      setBeLoggedIn(false);
      setStatus("BE: ログアウト");
    }
    if (isTauriRuntime()) {
      invoke("clear_login_cookies", { provider }).catch((e) => console.warn("clear_login_cookies:", e));
    }
  };

  return {
    // State
    authStatus, setAuthStatus,
    loginProbe, setLoginProbe,
    authConfig, setAuthConfig,
    roninLoggedIn, setRoninLoggedIn,
    beLoggedIn, setBeLoggedIn,
    authSaveMsg, setAuthSaveMsg,
    // Functions
    checkAuthEnv,
    probeAuth,
    doLogin,
    doLogout,
  };
}
