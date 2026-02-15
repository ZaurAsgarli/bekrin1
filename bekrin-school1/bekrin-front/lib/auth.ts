"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { ACCESS_TOKEN_COOKIE, USER_ROLE_COOKIE, UserRole } from "./constants";

export interface AuthUser {
  email: string;
  role: UserRole;
  fullName: string;
  mustChangePassword?: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

function setCookie(name: string, value: string, days = 7) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${expires}; path=/; SameSite=Lax;`;
}

function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
}

/** Clear auth cookies (for 401/403 forced re-auth). Call before redirect. */
export function clearAuthCookies() {
  clearCookie(ACCESS_TOKEN_COOKIE);
  clearCookie(USER_ROLE_COOKIE);
}

export function useLogin() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const data = await api.post<LoginResponse>("/auth/login", payload);
      // Token idealda httpOnly cookie ilə backend tərəfindən yazılacaq.
      // Hazırda minimal şəkildə frontend cookie-sini saxlayırıq.
      setCookie(ACCESS_TOKEN_COOKIE, data.accessToken);
      setCookie(USER_ROLE_COOKIE, data.user.role);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      if (data.user.mustChangePassword) {
        router.replace("/change-password");
        return;
      }
      const role = (data.user.role || "").toLowerCase();
      if (role === "teacher") router.replace("/teacher");
      else if (role === "student") router.replace("/student");
      else if (role === "parent") router.replace("/parent");
      else router.replace("/login");
    },
  });
}

/** Cache /me for 60 seconds to avoid duplicate calls and reduce load */
export function useMe(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthUser>("/auth/me"),
    staleTime: 60 * 1000, // Cache for 60 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 1,
    enabled: options?.enabled ?? true,
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api.post<{ detail: string }>("/auth/change-password", {
    currentPassword,
    newPassword,
  });
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await api.post("/auth/logout");
      } catch {
        // ignore backend error
      }
      clearAuthCookies();
    },
    onSuccess: () => {
      queryClient.clear();
      router.replace("/login");
    },
  });
}
