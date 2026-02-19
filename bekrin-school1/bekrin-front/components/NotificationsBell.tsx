"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, Plus } from "lucide-react";
import { teacherApi, Notification } from "@/lib/teacher";
import Link from "next/link";
import { formatPaymentDisplay } from "@/lib/formatPayment";

export function NotificationsBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ notifications: Notification[]; unread_count: number }>({
    queryKey: ["teacher", "notifications"],
    queryFn: () => teacherApi.getNotifications(),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: number) => teacherApi.markNotificationRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "notifications"] });
    },
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const queryClient = useQueryClient();
  const notifications = data?.notifications || [];
  const unreadCount = data?.unread_count || 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 flex items-center justify-center w-5 h-5 text-xs font-semibold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-[80vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">
              Bildirişlər
              {unreadCount > 0 && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  ({unreadCount})
                </span>
              )}
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-slate-100 rounded"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-4 text-center text-slate-500">Yüklənir...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                Bildiriş yoxdur
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className="p-4 hover:bg-slate-50 transition-colors"
                    onClick={() => {
                      if (!notif.is_read) {
                        markReadMutation.mutate(notif.id);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 mb-1">
                          {notif.student?.fullName || "Ümumi"}
                        </p>
                        <p className="text-sm text-red-600 font-medium mb-1">
                          {notif.message}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(notif.created_at).toLocaleString("az-AZ")}
                        </p>
                      </div>
                      {notif.student && (
                        <Link
                          href={`/teacher/payments?studentId=${notif.student.id}`}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(false);
                          }}
                        >
                          <Plus className="w-3 h-3" />
                          Ödəniş əlavə et
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
