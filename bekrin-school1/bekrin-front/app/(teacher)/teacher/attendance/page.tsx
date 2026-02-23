"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  teacherApi,
  AttendanceStatus,
  LESSON_DAY_LABELS,
} from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { AttendanceTableSkeleton } from "@/components/AttendanceTableSkeleton";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  LayoutGrid,
  BarChart3,
  Save,
  CheckCircle2,
  X,
} from "lucide-react";

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  {
    value: "present",
    label: "İştirak",
    color: "text-green-700",
    bg: "bg-green-100",
    border: "border-green-300",
  },
  {
    value: "absent",
    label: "Qeyri-iştirak",
    color: "text-red-700",
    bg: "bg-red-100",
    border: "border-red-300",
  },
  {
    value: "late",
    label: "Gecikmə",
    color: "text-amber-700",
    bg: "bg-amber-100",
    border: "border-amber-300",
  },
  {
    value: "excused",
    label: "Bəhanəli",
    color: "text-blue-700",
    bg: "bg-blue-100",
    border: "border-blue-300",
  },
];

const STATUS_PILL: Record<string, string> = {
  present: "bg-green-100 text-green-700",
  absent: "bg-red-100 text-red-700",
  late: "bg-amber-100 text-amber-700",
  excused: "bg-slate-100 text-slate-700",
};

const STATUS_SHORT: Record<string, string> = {
  present: "İşt",
  absent: "Qey",
  late: "Gec",
  excused: "Bəh",
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getWeekdayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const js = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const our = js === 0 ? 7 : js; // our 1=Mon, 7=Sun
  return LESSON_DAY_LABELS[our] ?? "";
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type PresetKey = "last8" | "last15" | "thisMonth" | "custom";

export default function AttendancePage() {
  const today = new Date();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view") || "daily";
  const groupParam = searchParams.get("group");
  const dateParam = searchParams.get("date") || formatDate(today);

  const [view, setView] = useState<"daily" | "grid" | "monthly">(
    () => (viewParam as "daily" | "grid" | "monthly") || "daily"
  );
  const monthFromUrl = searchParams.get("month");
  const [monthParam, setMonthParam] = useState(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) return monthFromUrl;
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });
  const [breakdownStudent, setBreakdownStudent] = useState<{
    id: string;
    fullName: string;
    attendancePercent?: number;
    missedPercent?: number;
  } | null>(null);
  useEffect(() => {
    if (!viewParam && typeof window !== "undefined" && window.innerWidth < 768) {
      setView("daily");
    }
  }, [viewParam]);
  useEffect(() => {
    if (monthFromUrl && /^\d{4}-\d{2}$/.test(monthFromUrl)) {
      setMonthParam(monthFromUrl);
    }
  }, [monthFromUrl]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groupParam || "");
  const [selectedDate, setSelectedDate] = useState(dateParam);
  const [preset, setPreset] = useState<PresetKey>("last8");
  const [customFrom, setCustomFrom] = useState(formatDate(new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(formatDate(today));
  const [localStatus, setLocalStatus] = useState<Record<string, AttendanceStatus>>({});
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "absent" | "late">("");
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>("present");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openCellMenu, setOpenCellMenu] = useState<{
    studentId: string;
    dateStr: string;
  } | null>(null);
  const cellMenuRef = useRef<HTMLDivElement | null>(null);

  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();
  const toast = useToast();
  const pendingBatch = useRef<Map<string, AttendanceStatus>>(new Map());
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasPendingBatch, setHasPendingBatch] = useState(false);

  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
  });

  const [yearParam, monthNumParam] = useMemo(() => {
    const [y, m] = monthParam.split("-").map(Number);
    return [y, m];
  }, [monthParam]);

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ["teacher", "attendance", "monthly", selectedGroupId, yearParam, monthNumParam],
    queryFn: () =>
      teacherApi.getAttendanceMonthly(
        selectedGroupId,
        yearParam,
        monthNumParam
      ),
    enabled: !!selectedGroupId && view === "monthly",
  });

  const { data: breakdownData } = useQuery({
    queryKey: [
      "teacher",
      "attendance",
      "breakdown",
      breakdownStudent?.id,
      monthParam,
    ],
    queryFn: () =>
      teacherApi.getStudentDailyBreakdown(
        selectedGroupId,
        breakdownStudent!.id,
        parseInt(monthParam.slice(0, 4), 10),
        parseInt(monthParam.slice(5, 7), 10)
      ),
    enabled: !!breakdownStudent && !!selectedGroupId,
  });

  const dateRange = useMemo((): { from: string; to: string } => {
    const t = new Date();
    const y = t.getFullYear();
    const m = t.getMonth();
    const d = t.getDate();
    if (preset === "last8" || preset === "last15") {
      const n = preset === "last8" ? 8 : 15;
      const to = formatDate(t);
      const from = formatDate(new Date(y, m, d - n * 7));
      return { from, to };
    }
    if (preset === "thisMonth") {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      return { from: formatDate(first), to: formatDate(last) };
    }
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const { data: gridData, isLoading: gridLoading } = useQuery({
    queryKey: ["attendanceGrid", selectedGroupId, dateRange.from, dateRange.to],
    queryFn: () =>
      teacherApi.getAttendanceGridNew({
        groupId: selectedGroupId,
        from: dateRange.from,
        to: dateRange.to,
      }),
    enabled: !!selectedGroupId && view === "grid",
  });

  const displayedDates = useMemo(() => {
    if (!gridData?.dates?.length) return [];
    const n = preset === "last8" ? 8 : preset === "last15" ? 15 : 999;
    return gridData.dates.slice(0, n);
  }, [gridData?.dates, preset]);

  const recordMap = useMemo(() => {
    const m = new Map<string, AttendanceStatus>();
    if (!gridData?.records) return m;
    for (const r of gridData.records) {
      m.set(`${r.student_id}_${r.date}`, r.status as AttendanceStatus);
    }
    return m;
  }, [gridData?.records]);

  const bulkUpsertMutation = useMutation({
    mutationFn: (items: { studentId: string; date: string; status: AttendanceStatus }[]) =>
      teacherApi.bulkUpsertAttendance({
        groupId: selectedGroupId,
        items,
      }),
    onSuccess: () => {
      setHasPendingBatch(false);
      queryClient.invalidateQueries({ queryKey: ["attendanceGrid"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceMonthly"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Xəta baş verdi");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (items: { studentId: string; date: string }[]) =>
      teacherApi.bulkDeleteAttendance({ groupId: selectedGroupId, items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendanceGrid"] });
      queryClient.invalidateQueries({ queryKey: ["attendanceMonthly"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Xəta baş verdi");
    },
  });

  const markAllPresentForDateMutation = useMutation({
    mutationFn: (dateStr: string) =>
      teacherApi.markAllPresentForDate({
        groupId: selectedGroupId,
        date: dateStr,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendanceGrid"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
      toast.success("Hamısı iştirak etdi olaraq işarələndi");
    },
    onError: (err: { message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["attendanceGrid"] });
      toast.error(err?.message || "Xəta baş verdi");
    },
  });

  const handleMarkAllPresentForGridDate = (dateStr: string) => {
    if (!gridData?.students) return;
    setLocalStatus((prev) => {
      const next = { ...prev };
      gridData.students.forEach((s) => {
        next[`${s.id}_${dateStr}`] = "present";
      });
      return next;
    });
    markAllPresentForDateMutation.mutate(dateStr);
  };

  const flushBatch = useCallback(() => {
    if (pendingBatch.current.size === 0) return;
    const items = Array.from(pendingBatch.current.entries()).map(
      ([key, status]) => {
        const [sid, date] = key.split("_");
        return { studentId: sid, date, status };
      }
    );
    pendingBatch.current.clear();
    setHasPendingBatch(false);
    if (batchTimer.current) {
      clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }
    bulkUpsertMutation.mutate(items);
  }, [bulkUpsertMutation]);

  const setCellStatus = useCallback(
    (studentId: string, dateStr: string, status: AttendanceStatus | null) => {
      const key = `${studentId}_${dateStr}`;
      if (status === null) {
        setLocalStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        pendingBatch.current.delete(key);
        bulkDeleteMutation.mutate([{ studentId, date: dateStr }]);
        return;
      }
      setLocalStatus((prev) => ({
        ...prev,
        [key]: status,
      }));
      pendingBatch.current.set(key, status);
      setHasPendingBatch(true);
      if (batchTimer.current) clearTimeout(batchTimer.current);
      batchTimer.current = setTimeout(flushBatch, 500);
    },
    [flushBatch, bulkDeleteMutation]
  );

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["teacher", "attendance", "daily", selectedGroupId, selectedDate],
    queryFn: () => teacherApi.getAttendanceDaily(selectedGroupId, selectedDate),
    enabled: !!selectedGroupId && view === "daily",
  });

  const saveMutation = useMutation({
    mutationFn: (data: {
      date: string;
      groupId: string;
      records: { studentId: string; status: AttendanceStatus }[];
      finalize?: boolean;
    }) => {
      // PART 1: Log request details for debugging
      console.log("[ATTENDANCE_SAVE] Calling API:", {
        url: "/api/teacher/attendance/save",
        method: "POST",
        body: data,
      });
      return teacherApi.saveAttendance(data);
    },
    onSuccess: (data) => {
      console.log("[ATTENDANCE_SAVE] Response received:", data);
      
      // PART 3: Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "notifications", "low-balance"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "stats"] });
      
      // Success / already marked: no balance info in toast
      if (data.charged && data.charged_count > 0) {
        toast.success("Attendance successfully marked.", { duration: 5000 });
      } else if (data.charged === false && data.finalize !== false) {
        toast.info("Attendance was already marked for this lesson.");
      } else {
        toast.success("Attendance successfully marked.");
      }
      setLocalStatus({});
    },
    onError: (err: any) => {
      console.error("[ATTENDANCE_SAVE] Error:", err);
      toast.error("Failed to mark attendance.");
    },
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        openCellMenu &&
        cellMenuRef.current &&
        !cellMenuRef.current.contains(e.target as Node)
      ) {
        setOpenCellMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openCellMenu]);

  useEffect(() => {
    if (dailyData?.students) {
      const map: Record<string, AttendanceStatus> = {};
      dailyData.students.forEach((s) => {
        map[s.id] = s.status;
      });
      setLocalStatus(map);
      setSelectedIds(new Set());
    }
  }, [dailyData]);

  const syncUrl = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v) params.set(k, v);
        else params.delete(k);
      });
      router.replace(`/teacher/attendance?${params.toString()}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  const changeView = (v: "daily" | "grid" | "monthly") => {
    setView(v);
    syncUrl({ view: v });
  };

  const changeGroup = (id: string) => {
    setSelectedGroupId(id);
    syncUrl({ group: id });
  };

  const handleSave = (finalize: boolean = false) => {
    if (!selectedGroupId || !dailyData) return;
    flushBatch();
    // Build records from daily students only; use daily key (student.id) for status so we never send grid composite keys (e.g. "1_2026-02-23") as studentId
    const records = dailyData.students
      .map((s) => ({
        studentId: s.id,
        status: localStatus[s.id] ?? ("absent" as AttendanceStatus),
      }))
      .filter((r) => r.status != null);
    saveMutation.mutate({
      date: selectedDate,
      groupId: selectedGroupId,
      records,
      finalize,
    });
  };

  const markAllPresent = () => {
    if (view === "daily" && dailyData) {
      const next: Record<string, AttendanceStatus> = {};
      dailyData.students.forEach((s) => {
        next[s.id] = "present";
      });
      setLocalStatus(next);
      saveMutation.mutate({
        date: selectedDate,
        groupId: selectedGroupId,
        records: dailyData.students.map((s) => ({ studentId: s.id, status: "present" as AttendanceStatus })),
        finalize: true, // Finalize lesson and charge students
      });
      toast.success("Hamısı iştirak etdi olaraq işarələndi");
    } else if (view === "grid" && gridData?.students?.length) {
      const todayStr = formatDate(today);
      gridData.students.forEach((s) => {
        setCellStatus(s.id, todayStr, "present");
      });
      toast.success("Bu gün hamısı iştirak etdi olaraq işarələndi");
    }
  };

  const applyBulk = () => {
    if (selectedIds.size === 0) return;
    const next = { ...localStatus };
    selectedIds.forEach((id) => {
      next[id] = bulkStatus;
    });
    setLocalStatus(next);
    setSelectedIds(new Set());
    toast.success(`${selectedIds.size} şagird yeniləndi`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredDailyStudents = useMemo(() => {
    if (!dailyData?.students) return [];
    let list = dailyData.students;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((s) => s.fullName.toLowerCase().includes(q));
    }
    if (filterStatus) {
      list = list.filter(
        (s) => (localStatus[s.id] ?? s.status) === filterStatus
      );
    }
    return list;
  }, [dailyData, debouncedSearch, filterStatus, localStatus]);

  const filteredGridStudents = useMemo(() => {
    if (!gridData?.students) return [];
    let list = gridData.students;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((s) =>
        (s.full_name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [gridData?.students, debouncedSearch]);

  const filteredMonthlyStudents = useMemo(() => {
    if (!monthlyData?.students) return [];
    let list = monthlyData.students;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter((s) =>
        (s.fullName || (s as { full_name?: string }).full_name || "")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [monthlyData?.students, debouncedSearch]);

  const monthName = useMemo(() => {
    const [y, m] = monthParam.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("az-AZ", {
      month: "long",
      year: "numeric",
    });
  }, [monthParam]);

  const hasChanges = useMemo(() => {
    if (!dailyData) return false;
    return dailyData.students.some(
      (s) => (localStatus[s.id] ?? s.status) !== s.status
    );
  }, [dailyData, localStatus]);

  const isSaving = bulkUpsertMutation.isPending || saveMutation.isPending;

  const selectedGroup = groups?.find((g) => g.id === selectedGroupId);
  const todayWeekday = (() => {
    const d = today.getDay();
    return d === 0 ? 7 : d;
  })();
  const todayIsLessonDay =
    !!selectedGroup?.lesson_days?.length &&
    selectedGroup.lesson_days.includes(todayWeekday);
  const gridMarkAllDisabled = view === "grid" && !todayIsLessonDay;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-slate-50">
      <div className="page-container pb-24">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">Davamiyyət</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => changeView("daily")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-sm transition-all ${
                view === "daily"
                  ? "bg-primary text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
              }`}
            >
              <Calendar className="w-4 h-4" />
              Gündəlik
            </button>
            <button
              onClick={() => changeView("grid")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-sm transition-all ${
                view === "grid"
                  ? "bg-primary text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Cədvəl
            </button>
            <button
              onClick={() => changeView("monthly")}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-sm transition-all ${
                view === "monthly"
                  ? "bg-primary text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Aylıq
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div>
            <label className="label">Qrup *</label>
            <select
              className="input max-w-xs rounded-xl border-slate-300 shadow-sm"
              value={selectedGroupId}
              onChange={(e) => changeGroup(e.target.value)}
            >
              <option value="">Qrup seçin</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.display_name || g.name}
                </option>
              ))}
            </select>
          </div>

          {view === "grid" && selectedGroupId && (
            <>
              <div>
                <label className="label">Aralıq</label>
                <select
                  className="input max-w-[180px] rounded-xl"
                  value={preset}
                  onChange={(e) =>
                    setPreset(e.target.value as PresetKey)
                  }
                >
                  <option value="last8">Son 8 dərs</option>
                  <option value="last15">Son 15 dərs</option>
                  <option value="thisMonth">Bu ay</option>
                  <option value="custom">Seçilmiş aralıq</option>
                </select>
              </div>
              {preset === "custom" && (
                <div className="flex gap-2">
                  <div>
                    <label className="label">Başlanğıc</label>
                    <input
                      type="date"
                      className="input rounded-xl max-w-[140px]"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Son</label>
                    <input
                      type="date"
                      className="input rounded-xl max-w-[140px]"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {view === "daily" && selectedGroupId && (
            <div>
              <label className="label">Tarix</label>
              <input
                type="date"
                className="input max-w-[180px] rounded-xl"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  syncUrl({ date: e.target.value });
                }}
              />
            </div>
          )}
          {view === "monthly" && selectedGroupId && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const [y, m] = monthParam.split("-").map(Number);
                  const d = new Date(y, m - 2, 1);
                  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  setMonthParam(next);
                  syncUrl({ month: next });
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="font-semibold min-w-[180px] text-center">
                {monthName}
              </span>
              <button
                onClick={() => {
                  const [y, m] = monthParam.split("-").map(Number);
                  const d = new Date(y, m, 1);
                  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  setMonthParam(next);
                  syncUrl({ month: next });
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {selectedGroupId && (
            <>
              <div className="flex-1 min-w-[200px] max-w-xs">
                <label className="label opacity-0">Axtarış</label>
                <input
                  type="text"
                  placeholder="Şagird axtar..."
                  className="input rounded-xl"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {(view === "daily" && dailyData?.students?.length) ||
              (view === "grid" && gridData?.students?.length) ||
              (view === "monthly" && monthlyData?.students?.length) ? (
                <>
                  {view === "daily" && (
                  <div className="flex gap-2 items-end">
                    <button
                      onClick={() => setFilterStatus("")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                        !filterStatus
                          ? "bg-slate-200"
                          : "bg-slate-100 hover:bg-slate-200"
                      }`}
                    >
                      Hamısı
                    </button>
                    <button
                      onClick={() =>
                        setFilterStatus(
                          filterStatus === "absent" ? "" : "absent"
                        )
                      }
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                        filterStatus === "absent"
                          ? "bg-red-200"
                          : "bg-slate-100 hover:bg-slate-200"
                      }`}
                    >
                      Qeyri-iştirak
                    </button>
                    <button
                      onClick={() =>
                        setFilterStatus(filterStatus === "late" ? "" : "late")
                      }
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                        filterStatus === "late"
                          ? "bg-amber-200"
                          : "bg-slate-100 hover:bg-slate-200"
                      }`}
                    >
                      Gecikmə
                    </button>
                  </div>
                  )}
                  <button
                    onClick={markAllPresent}
                    disabled={gridMarkAllDisabled}
                    title={
                      gridMarkAllDisabled
                        ? "Bu gün dərs günü deyil"
                        : undefined
                    }
                    className="btn-outline flex items-center gap-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Hamısı iştirak
                  </button>
                  {view === "daily" && selectedIds.size > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        className="input py-1.5 w-36 rounded-xl"
                        value={bulkStatus}
                        onChange={(e) =>
                          setBulkStatus(e.target.value as AttendanceStatus)
                        }
                      >
                        {STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={applyBulk}
                        className="btn-primary py-1.5 rounded-xl"
                      >
                        {selectedIds.size} nəfərə tətbiq et
                      </button>
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="p-1.5 hover:bg-slate-100 rounded-lg"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>

        {/* GRID VIEW */}
        {view === "grid" && (
          <>
            {!selectedGroupId ? (
              <div className="card rounded-2xl shadow-md border-slate-200/80 text-center py-16">
                <p className="text-slate-500">
                  Davamiyyət üçün qrup seçin
                </p>
              </div>
            ) : gridLoading ? (
              <AttendanceTableSkeleton rows={12} />
            ) : !displayedDates.length ? (
              <div className="card rounded-2xl shadow-md border-slate-200/80 text-center py-16">
                <p className="text-slate-500">
                  Bu aralıqda dərs yoxdur
                </p>
              </div>
            ) : !filteredGridStudents.length ? (
              <div className="card rounded-2xl shadow-md border-slate-200/80 text-center py-16">
                <p className="text-slate-500">
                  Bu qrupda şagird tapılmadı
                </p>
              </div>
            ) : (
              <div className="card rounded-2xl shadow-lg border-slate-200/80 overflow-hidden">
                <div className="flex justify-end items-center gap-2 pr-4 py-2 border-b border-slate-100">
                  {!isSaving && !hasPendingBatch && (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Saxlanılıb
                    </span>
                  )}
                  {(isSaving || hasPendingBatch) && (
                    <span className="text-xs text-amber-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Saxlanılır...
                    </span>
                  )}
                </div>
                <div
                  className="overflow-auto max-h-[min(70vh,640px)]"
                  style={{ minHeight: "320px" }}
                >
                  <table className="w-full border-collapse min-w-[600px]">
                    <thead className="sticky top-0 bg-white z-10 shadow-sm">
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 sticky left-0 bg-white z-20 min-w-[180px]">
                          Şagird
                        </th>
                        {displayedDates.map((dateStr) => {
                          const isToday = dateStr === formatDate(today);
                          return (
                            <th
                              key={dateStr}
                              className={`py-2 px-2 text-center min-w-[72px] ${
                                isToday
                                  ? "bg-primary/10 font-semibold text-primary"
                                  : "text-slate-600"
                              }`}
                            >
                              <div className="text-xs font-medium">
                                {dateStr.slice(8, 10)}/{dateStr.slice(5, 7)}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {getWeekdayLabel(dateStr)}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  handleMarkAllPresentForGridDate(dateStr)
                                }
                                disabled={
                                  markAllPresentForDateMutation.isPending
                                }
                                className="mt-1 text-[10px] text-primary hover:underline font-medium"
                              >
                                Hamısı iştirak
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGridStudents.map((student, idx) => (
                        <tr
                          key={student.id}
                          className={`border-b border-slate-100 hover:bg-slate-50/80 ${
                            idx % 2 === 1 ? "bg-slate-50/40" : ""
                          }`}
                        >
                          <td className="py-2 px-4 text-sm font-medium text-slate-900 sticky left-0 bg-inherit z-10">
                            {student.full_name}
                          </td>
                          {displayedDates.map((dateStr) => {
                            const key = `${student.id}_${dateStr}`;
                            const status =
                              localStatus[key] ??
                              recordMap.get(key) ??
                              null;
                            const isToday = dateStr === formatDate(today);
                            const isMenuOpen =
                              openCellMenu?.studentId === student.id &&
                              openCellMenu?.dateStr === dateStr;
                            return (
                              <td
                                key={dateStr}
                                className={`py-1 px-1 text-center ${
                                  isToday ? "bg-primary/5" : ""
                                }`}
                              >
                                <div
                                  ref={
                                    isMenuOpen ? cellMenuRef : undefined
                                  }
                                  className="relative inline-block"
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenCellMenu(
                                        isMenuOpen
                                          ? null
                                          : {
                                              studentId: student.id,
                                              dateStr,
                                            }
                                      )
                                    }
                                    className={`inline-flex items-center justify-center min-w-[56px] px-2 py-1 rounded-lg text-xs font-medium transition-all hover:ring-2 hover:ring-primary/30 ${
                                      status
                                        ? `${STATUS_PILL[status] ?? "bg-slate-100"} cursor-pointer`
                                        : "bg-slate-50 text-slate-400 hover:bg-slate-100 cursor-pointer"
                                    }`}
                                  >
                                    {status
                                      ? STATUS_SHORT[status] ?? status
                                      : "-"}
                                  </button>
                                  {isMenuOpen && (
                                    <div className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-lg border border-slate-200 bg-white py-1 min-w-[160px]">
                                      {STATUS_OPTIONS.map((opt) => (
                                        <button
                                          key={opt.value}
                                          type="button"
                                          onClick={() => {
                                            setCellStatus(
                                              student.id,
                                              dateStr,
                                              opt.value
                                            );
                                            setOpenCellMenu(null);
                                          }}
                                          className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-slate-50 ${opt.color}`}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setCellStatus(
                                            student.id,
                                            dateStr,
                                            null
                                          );
                                          setOpenCellMenu(null);
                                        }}
                                        className="w-full text-left px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 border-t border-slate-100"
                                      >
                                        Təmizlə
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* MONTHLY VIEW — Stats only, click student opens calendar modal */}
        {view === "monthly" && (
          <>
            {!selectedGroupId ? (
              <div className="card rounded-2xl shadow-md border-slate-200/80 text-center py-16">
                <p className="text-slate-500">Davamiyyət üçün qrup seçin</p>
              </div>
            ) : monthlyLoading ? (
              <AttendanceTableSkeleton rows={12} />
            ) : !monthlyData?.students?.length ? (
              <div className="card rounded-2xl shadow-md border-slate-200/80 text-center py-16">
                <p className="text-slate-500">
                  Bu qrupda şagird tapılmadı
                </p>
              </div>
            ) : (
              <div className="card rounded-2xl shadow-lg border-slate-200/80 overflow-hidden">
                <div
                  className="overflow-auto max-h-[min(70vh,640px)]"
                  style={{ minHeight: "320px" }}
                >
                  <table className="w-full border-collapse min-w-[500px]">
                    <thead className="sticky top-0 bg-white z-10 shadow-sm">
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 sticky left-0 bg-white z-20 min-w-[180px]">
                          Şagird
                        </th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-600 min-w-[80px]">
                          İştirak
                        </th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-600 min-w-[90px]">
                          Qeyri-iştirak
                        </th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-600 min-w-[70px]">
                          Gecikmə
                        </th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-600 min-w-[80px]">
                          Bəhanəli
                        </th>
                        <th className="text-center py-3 px-3 text-sm font-semibold text-slate-600 min-w-[60px]">
                          %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMonthlyStudents.map((student, idx) => {
                        const s = student as {
                          id: string;
                          fullName: string;
                          present: number;
                          absent: number;
                          late: number;
                          excused: number;
                          attendancePercent: number;
                        };
                        const pct = s.attendancePercent ?? 0;
                        return (
                          <tr
                            key={s.id}
                            className={`border-b border-slate-100 hover:bg-slate-50/80 cursor-pointer ${
                              idx % 2 === 1 ? "bg-slate-50/40" : ""
                            } ${pct < 75 ? "bg-red-50/50" : ""}`}
                            onClick={() =>
                              setBreakdownStudent({
                                id: s.id,
                                fullName: s.fullName,
                                attendancePercent: pct,
                              })
                            }
                          >
                            <td className="py-2 px-4 text-sm font-medium text-slate-900 sticky left-0 bg-inherit z-10">
                              {s.fullName}
                            </td>
                            <td className="py-2 px-3 text-center text-sm text-slate-700">
                              {s.present ?? 0}
                            </td>
                            <td className="py-2 px-3 text-center text-sm text-slate-700">
                              {s.absent ?? 0}
                            </td>
                            <td className="py-2 px-3 text-center text-sm text-slate-700">
                              {s.late ?? 0}
                            </td>
                            <td className="py-2 px-3 text-center text-sm text-slate-700">
                              {s.excused ?? 0}
                            </td>
                            <td
                              className={`py-2 px-3 text-center text-sm font-semibold ${
                                pct < 75 ? "text-red-600" : "text-slate-700"
                              }`}
                            >
                              {pct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* DAILY VIEW */}
        {view === "daily" && (
          <>
            {!selectedGroupId ? (
              <div className="card rounded-2xl shadow-md border-slate-200/80 text-center py-16">
                <p className="text-slate-500">
                  Davamiyyət üçün qrup seçin
                </p>
              </div>
            ) : dailyLoading ? (
              <AttendanceTableSkeleton rows={15} />
            ) : dailyData?.students?.length ? (
              <div className="card rounded-2xl shadow-lg overflow-hidden border-slate-200/80">
                <div
                  className="overflow-auto max-h-[min(65vh,600px)]"
                  style={{ minHeight: "320px" }}
                >
                  <table className="w-full">
                    <thead className="sticky top-0 bg-white z-10 shadow-sm">
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 px-4 text-xs font-semibold text-slate-600 w-10">
                          #
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-slate-600 w-10">
                          <input
                            type="checkbox"
                            checked={
                              filteredDailyStudents.length > 0 &&
                              filteredDailyStudents.every((s) =>
                                selectedIds.has(s.id)
                              )
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds(
                                  new Set(filteredDailyStudents.map((s) => s.id))
                                );
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                            className="rounded"
                          />
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                          Şagird
                        </th>
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700 w-48">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDailyStudents.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-12 text-center text-slate-500"
                          >
                            Axtarış nəticəsi tapılmadı
                          </td>
                        </tr>
                      ) : (
                        filteredDailyStudents.map((student, idx) => {
                          const status =
                            localStatus[student.id] ?? student.status;
                          return (
                            <tr
                              key={student.id}
                              className="border-b border-slate-100 hover:bg-slate-50/80"
                            >
                              <td className="py-2.5 px-4 text-sm text-slate-500">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-4">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(student.id)}
                                  onChange={() => toggleSelect(student.id)}
                                  className="rounded"
                                />
                              </td>
                              <td className="py-2.5 px-4 text-sm font-medium text-slate-900">
                                {student.fullName}
                              </td>
                              <td className="py-2 px-4">
                                <select
                                  value={status}
                                  onChange={(e) => {
                                    const val = e.target
                                      .value as AttendanceStatus;
                                    setLocalStatus((prev) => ({
                                      ...prev,
                                      [student.id]: val,
                                    }));
                                  }}
                                  className={`w-full rounded-lg border py-2 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                    STATUS_OPTIONS.find((o) => o.value === status)
                                      ?.border || "border-slate-300"
                                  } ${
                                    STATUS_OPTIONS.find((o) => o.value === status)
                                      ?.bg || "bg-white"
                                  }`}
                                >
                                  {STATUS_OPTIONS.map((opt) => (
                                    <option
                                      key={opt.value}
                                      value={opt.value}
                                    >
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="card rounded-2xl shadow-md text-center py-16">
                <p className="text-slate-500">Bu qrupda şagird tapılmadı</p>
              </div>
            )}

            {view === "daily" &&
              selectedGroupId &&
              dailyData?.students?.length &&
              hasChanges && (
                <div className="fixed bottom-0 left-0 right-0 md:left-56 bg-white border-t border-slate-200 shadow-lg px-4 py-3 flex items-center justify-between gap-3 z-20">
                  <p className="text-sm text-slate-600">
                    Dəyişikliklər saxlanılmayıb
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSave(false)}
                      disabled={saveMutation.isPending}
                      className="btn-outline flex items-center gap-2 rounded-xl"
                    >
                      <Save className="w-4 h-4" />
                      {saveMutation.isPending ? "Saxlanılır..." : "Saxla"}
                    </button>
                    <button
                      onClick={() => handleSave(true)}
                      disabled={saveMutation.isPending}
                      className="btn-primary flex items-center gap-2 rounded-xl"
                    >
                      <Save className="w-4 h-4" />
                      {saveMutation.isPending ? "Saxlanılır..." : "Saxla və dərsi tamamla"}
                    </button>
                  </div>
                </div>
              )}
          </>
        )}

        {/* Monthly breakdown modal */}
        <Modal
          isOpen={!!breakdownStudent}
          onClose={() => setBreakdownStudent(null)}
          title={
            breakdownStudent
              ? `${breakdownStudent.fullName} — Gündəlik davamiyyət (${monthName})`
              : ""
          }
          size="lg"
        >
          {breakdownStudent && breakdownData && (() => {
            const [y, m] = [breakdownData.year, breakdownData.month];
            const first = new Date(y, m - 1, 1);
            const last = new Date(y, m, 0);
            const lastDay = last.getDate();
            const startCol = (first.getDay() + 6) % 7;
            const recordMap = new Map(
              breakdownData.records.map((r) => [r.date, r.status])
            );
            const cells: (number | null)[] = [];
            for (let i = 0; i < startCol; i++) cells.push(null);
            for (let d = 1; d <= lastDay; d++) {
              const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              cells.push(d);
            }
            return (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Davamiyyət: {breakdownStudent.attendancePercent ?? 0}%
                {breakdownStudent.missedPercent != null &&
                  ` (Qaçırılan: ${breakdownStudent.missedPercent}%)`}
              </p>
              <div className="grid grid-cols-7 gap-1">
                {["B.e", "Ç.a", "Ç", "C.a", "C", "Ş", "B"].map((d) => (
                  <div
                    key={d}
                    className="text-center py-1.5 text-xs font-semibold text-slate-600"
                  >
                    {d}
                  </div>
                ))}
                {cells.map((day, idx) => {
                  if (day === null) {
                    return <div key={`empty-${idx}`} className="aspect-square" />;
                  }
                  const ds = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const status = recordMap.get(ds);
                  return (
                    <div
                      key={ds}
                      className="flex flex-col items-center justify-center rounded-lg border border-slate-100 p-2 aspect-square min-h-[44px]"
                      title={`${ds}: ${status || "-"}`}
                    >
                      <span className="text-slate-700 text-sm font-medium">
                        {day}
                      </span>
                      <span
                        className={`w-2.5 h-2.5 rounded-full mt-1 ${
                          status === "present"
                            ? "bg-green-500"
                            : status === "absent"
                            ? "bg-red-500"
                            : status === "late"
                            ? "bg-amber-500"
                            : status === "excused"
                            ? "bg-blue-500"
                            : "bg-slate-200"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" /> İştirak
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />{" "}
                  Qeyri-iştirak
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Gecikmə
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> Bəhanəli
                </span>
              </div>
            </div>
            );
          })()}
        </Modal>
      </div>
    </div>
  );
}
