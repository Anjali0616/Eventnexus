"use client";

import { useEffect, useState } from "react";

// Whether a session token exists in localStorage — used to gate every
// auth-only query (`enabled: useHasToken()`).
//
// This intentionally starts at `false` on every render, including the very
// first one in the browser, and only flips to the real value inside an
// effect. Reading localStorage synchronously during render instead (the
// previous `typeof window !== "undefined" && !!localStorage.getItem(...)`
// pattern) makes the first client render diverge from the server-rendered
// HTML — the server never sees `window`, so it always renders the
// logged-out branch, while the client's first render already has the token
// and renders the logged-in branch. React hydrates against the server
// output, so that first-paint mismatch throws a hydration error and forces
// a full client re-render. Starting both renders at `false` keeps the first
// paint identical; the effect-driven flip afterwards is a normal state
// update, not a hydration diff. Polling + storage listener keeps same-tab
// writes (storeSession) in sync without reload.
export function useHasToken() {
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => {
    const check = () => setHasToken(!!localStorage.getItem("token"));
    check();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "token") check();
    };
    window.addEventListener("storage", onStorage);
    const interval = setInterval(check, 1000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);
  return hasToken;
}

export function useHasTokenWithChecked() {
  const [hasToken, setHasToken] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const check = () => {
      setHasToken(!!localStorage.getItem("token"));
      setChecked(true);
    };
    check();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "token") check();
    };
    window.addEventListener("storage", onStorage);
    const interval = setInterval(check, 1000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, []);
  return { hasToken, checked };
}
