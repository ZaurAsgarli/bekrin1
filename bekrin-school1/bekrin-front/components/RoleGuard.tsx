"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/useAuth";
import { clearAuthCookies } from "@/lib/auth";
import { UserRole } from "@/lib/constants";
import { Loading } from "./Loading";

export type RequiredRole = UserRole;

interface RoleGuardProps {
  children: React.ReactNode;
  requiredRole: RequiredRole;
}

const FORBIDDEN_MESSAGE =
  "Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun.";

/**
 * Protects routes by role. If user is not authenticated or has wrong role,
 * clears token and redirects to login (force re-auth).
 */
export function RoleGuard({ children, requiredRole }: RoleGuardProps) {
  const { isAuthenticated, role, loading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (redirectedRef.current) return;

    if (!isAuthenticated || !role) {
      redirectedRef.current = true;
      clearAuthCookies();
      queryClient.clear();
      router.replace("/login?reason=unauthorized");
      return;
    }

    // Block access if role doesn't match required role
    if (role !== requiredRole) {
      redirectedRef.current = true;
      clearAuthCookies();
      queryClient.clear();
      const msg = encodeURIComponent(FORBIDDEN_MESSAGE);
      router.replace(`/login?reason=forbidden&message=${msg}`);
      return;
    }
  }, [loading, isAuthenticated, role, requiredRole, router, queryClient]);

  if (loading) {
    return <Loading />;
  }

  if (!isAuthenticated || !role || role !== requiredRole) {
    return <Loading />;
  }

  return <>{children}</>;
}
