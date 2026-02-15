/** API base URL (e.g. http://localhost:8000/api). Single source of truth for backend connectivity. */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

export const ACCESS_TOKEN_COOKIE = "accessToken";
export const USER_ROLE_COOKIE = "userRole";

export type UserRole = "teacher" | "student" | "parent";
