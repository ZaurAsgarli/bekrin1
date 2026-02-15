import { API_BASE_URL } from "./constants";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  console.log("[dev] API base URL:", API_BASE_URL);
}

export interface ApiError {
  status: number;
  message: string;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return decodeURIComponent(parts.pop()!.split(";").shift()!);
  return null;
}

async function request<T>(
  path: string,
  options: RequestInit & { method?: HttpMethod } = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getCookie("accessToken");

  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...((options.headers as Record<string, string>) || {}),
  };

  // Token varsa Authorization header-ə əlavə et
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    body: options.body,
  });

  if (res.status === 401 && typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (!path.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      window.location.href = "/login?reason=unauthorized";
    }
    throw new Error("Unauthorized");
  }

  if (res.status === 403 && typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (!path.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      const msg = encodeURIComponent("Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun.");
      window.location.href = `/login?reason=forbidden&message=${msg}`;
    }
    throw new Error("Forbidden");
  }

  if (!res.ok) {
    let message = "Naməlum xəta baş verdi";
    try {
      const data = await res.json();
      message = (data?.error ?? data?.detail ?? data?.message ?? message) as string;
    } catch {
      // ignore
    }
    const error: ApiError = { status: res.status, message };
    throw error;
  }

  if (res.status === 204) {
    // no content
    return {} as T;
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  getBlob: async (path: string): Promise<Blob> => {
    const url = `${API_BASE_URL}${path}`;
    const token = getCookie("accessToken");
    const headers: HeadersInit = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { method: "GET", headers, credentials: "include" });
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      window.location.href = "/login?reason=unauthorized";
      throw new Error("Unauthorized");
    }
    if (res.status === 403 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      document.cookie = "accessToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      document.cookie = "userRole=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      const msg = encodeURIComponent("Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun.");
      window.location.href = `/login?reason=forbidden&message=${msg}`;
      throw new Error("Forbidden");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  post: <T>(path: string, body?: unknown, opts?: { headers?: HeadersInit }) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      headers: opts?.headers,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

