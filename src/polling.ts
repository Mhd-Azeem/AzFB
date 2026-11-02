/** Visible tabs refresh on a timer and immediately on return or reconnect. */
export function subscribeAutoRefresh(reload: () => void, pollMs: number) {
  const visible = () => {
    if (document.visibilityState === "visible") reload();
  };
  const timer = setInterval(visible, pollMs);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("online", visible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("online", visible);
  };
}
