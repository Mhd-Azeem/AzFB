import { subscribeAutoRefresh } from "../polling";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
export function useResource<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    setData(null);
  }, [path]);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, version]);
  useEffect(() => {
    window.addEventListener("crm:refresh", reload);
    return () => window.removeEventListener("crm:refresh", reload);
  }, [reload]);
  useEffect(() => {
    if (!pollMs) return;
    return subscribeAutoRefresh(reload, pollMs);
  }, [pollMs, reload]);
  return { data, loading, error, reload };
}
export function useDebounce(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
}
