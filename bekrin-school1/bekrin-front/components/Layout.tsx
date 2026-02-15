"use client";

import { useEffect, useState } from "react";
import { useMe, useLogout } from "@/lib/auth";
import { LogOut, User, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { teacherNav, studentNav, parentNav } from "@/lib/navigation";
import { BackButton } from "@/components/BackButton";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  const logout = useLogout();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (user?.mustChangePassword) {
      router.replace("/change-password");
    }
  }, [user?.mustChangePassword, router]);

  // Only use role from /api/auth/me - never infer from pathname
  const role = user?.role;
  const roleLabels: Record<string, string> = {
    teacher: "Müəllim",
    student: "Şagird",
    parent: "Valideyn",
  };

  // Determine nav based on role (fallback to empty if role not loaded yet)
  const nav =
    role === "teacher"
      ? teacherNav
      : role === "student"
      ? studentNav
      : role === "parent"
      ? parentNav
      : [];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 w-56 bg-white border-r border-slate-200 flex-shrink-0 z-50 transform transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="sticky top-0 py-4 h-full overflow-y-auto">
          <div className="px-4 mb-4 flex items-center justify-between">
            <div>
              <Link href={role === "teacher" ? "/teacher" : role === "student" ? "/student" : role === "parent" ? "/parent" : "/login"} className="text-lg font-semibold text-slate-900">
                Bekrin School
              </Link>
              {role && <p className="text-xs text-slate-500 mt-0.5">{roleLabels[role]} Paneli</p>}
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1 hover:bg-slate-100 rounded"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {role && (
            <nav className="space-y-0.5 px-2">
              {nav.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== `/${role}` && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="md:hidden p-2 hover:bg-slate-100 rounded-lg"
                aria-label="Toggle sidebar"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <BackButton />
              <h1 className="text-lg font-semibold text-slate-900 md:hidden">Bekrin School</h1>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <User className="w-4 h-4" />
                  <span>{user.fullName}</span>
                </div>
              )}
              <button
                onClick={() => logout.mutate()}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Çıxış
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
