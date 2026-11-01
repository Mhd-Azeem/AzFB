export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(
      0,
      "network",
      "Cannot reach the server. Check your connection and retry.",
    );
  }
  let result: {
    ok: boolean;
    data: T;
    error?: { code: string; message: string };
  };
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "invalid_response",
      "The CRM backend is unavailable. Start the Worker or check the deployment.",
    );
  }
  if (!response.ok || !result.ok) {
    if (response.status === 401 && csrf) {
      csrf = "";
      window.dispatchEvent(new Event("crm:session-expired"));
    }
    throw new ApiError(
      response.status,
      result.error?.code || "request_failed",
      result.error?.message || "Request failed.",
    );
  }
  return result.data;
}
export const write = <T>(path: string, value: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(value) });
export function refresh() {
  window.dispatchEvent(new Event("crm:refresh"));
}
export async function downloadExport(query: string) {
  const response = await fetch(`/api/leads/export?${query}`, {
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrf },
  });
  if (!response.ok) {
    let message = "Export failed.";
    try {
      message = (await response.json()).error.message;
    } catch {
      /* Report generic failure. */
    }
    if (response.status === 401)
      window.dispatchEvent(new Event("crm:session-expired"));
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement("a");
  link.href = url;
  link.download = "az-leads.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
