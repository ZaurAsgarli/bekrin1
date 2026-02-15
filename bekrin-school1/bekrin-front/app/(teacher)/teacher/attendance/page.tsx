"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, AttendanceStatus } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { AttendanceTableSkeleton } from "@/components/AttendanceTableSkeleton";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  BarChart3,
  LayoutGrid,
  Save,
  Download,
  ArrowUpDown,
  Search,
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
  { value: "present", label: "İştirak", color: "text-green-700", bg: "bg-green-50", border: "border-green-300" },
  { value: "absent", label: "Qeyri-iştirak", color: "text-red-700", bg: "bg-red-50", border: "border-red-300" },
  { value: "late", label: "Gecikmə", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-300" },
  { value: "excused", label: "Bəhanəli", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-300" },
];

const STATUS_ROW_BG: Record<string, string> = {
  present: "bg-green-50/50",
  absent: "bg-red-50/50",
  late: "bg-orange-50/50",
  excused: "bg-blue-50/50",
};

const STATUS_BADGE: Record<string, string> = {
  present: "bg-green-100 text-green-700",
  absent: "bg-red-100 text-red-700",
  late: "bg-orange-100 text-orange-700",
  excused: "bg-blue-100 text-blue-700",
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function AttendancePage() {
  const today = new Date();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view") || "daily";
  const groupParam = searchParams.get("group");
  const dateParam = searchParams.get("date") || formatDate(today);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  const [view, setView] = useState<"daily" | "monthly" | "grid">(
    (viewParam as "daily" | "monthly" | "grid") || "daily"
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groupParam || "");
  const [selectedDate, setSelectedDate] = useState(dateParam);
  const [year, setYear] = useState(
    yearParam ? parseInt(yearParam, 10) : today.getFullYear()
  );
  const [month, setMonth] = useState(
    monthParam ? parseInt(monthParam, 10) : today.getMonth() + 1
  );
  const [localStatus, setLocalStatus] = useState<Record<string, AttendanceStatus>>({});
  const [sortKey, setSortKey] = useState<"fullName" | "attendancePercent">("fullName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "absent" | "late">("");
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>("present");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [breakdownStudent, setBreakdownStudent] = useState<{
    id: string;
    fullName: string;
    attendancePercent: number;
  } | null>(null);

  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
  });

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ["teacher", "attendance", "daily", selectedGroupId, selectedDate],
    queryFn: () => teacherApi.getAttendanceDaily(selectedGroupId, selectedDate),
    enabled: !!selectedGroupId && view === "daily",
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ["teacher", "attendance", "monthly", selectedGroupId, year, month],
    queryFn: () => teacherApi.getAttendanceMonthly(selectedGroupId, year, month),
    enabled: !!selectedGroupId && view === "monthly",
  });

  const { data: breakdownData } = useQuery({
    queryKey: ["teacher", "attendance", "breakdown", breakdownStudent?.id, year, month],
    queryFn: () =>
      teacherApi.getStudentDailyBreakdown(selectedGroupId, breakdownStudent!.id, year, month),
    enabled: !!breakdownStudent && !!selectedGroupId,
  });

  const { data: gridData, isLoading: gridLoading } = useQuery({
    queryKey: ["teacher", "attendance", "grid", year, month],
    queryFn: () => teacherApi.getAttendanceGrid(year, month),
    enabled: view === "grid",
  });

  const saveMutation = useMutation({
    mutationFn: (data: {
      date: string;
      groupId: string;
      records: { studentId: string; status: AttendanceStatus }[];
    }) => teacherApi.saveAttendance(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
      toast.success(data.message || "Davamiyyət saxlanıldı");
    },
    onError: (err: { message?: string }) => {
      toast.error(err?.message || "Xəta baş verdi");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      groupId: string;
      studentId: string;
      date: string;
      status: AttendanceStatus;
    }) => teacherApi.updateAttendance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
    },
  });

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
      router.replace(`/teacher/attendance?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const changeView = (v: "daily" | "monthly" | "grid") => {
    setView(v);
    syncUrl({ view: v });
  };

  const changeGroup = (id: string) => {
    setSelectedGroupId(id);
    syncUrl({ group: id });
  };

  const handleSave = () => {
    if (!selectedGroupId || !dailyData) return;
    const records = Object.entries(localStatus).map(([studentId, status]) => ({
      studentId,
      status,
    }));
    saveMutation.mutate({
      date: selectedDate,
      groupId: selectedGroupId,
      records,
    });
  };

  const markAllPresent = () => {
    if (!dailyData) return;
    const next: Record<string, AttendanceStatus> = {};
    dailyData.students.forEach((s) => {
      next[s.id] = "present";
    });
    setLocalStatus(next);
    toast.success("Hamısı iştirak etdi olaraq işarələndi");
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
      list = list.filter((s) => (localStatus[s.id] ?? s.status) === filterStatus);
    }
    return list;
  }, [dailyData, debouncedSearch, filterStatus, localStatus]);

  const monthName = useMemo(() => {
    return new Date(year, month - 1, 1).toLocaleDateString("az-AZ", {
      month: "long",
      year: "numeric",
    });
  }, [year, month]);

  const sortedMonthlyStudents = useMemo(() => {
    if (!monthlyData?.students) return [];
    const arr = [...monthlyData.students];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "fullName") {
        cmp = a.fullName.localeCompare(b.fullName);
      } else {
        cmp = a.attendancePercent - b.attendancePercent;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [monthlyData, sortKey, sortDir]);

  const exportCsv = () => {
    if (!monthlyData) return;
    const headers = [
      "Şagird",
      "Email",
      "İştirak",
      "Qeyri-iştirak",
      "Gecikmə",
      "Bəhanəli",
      "Davamiyyət %",
    ];
    const rows = sortedMonthlyStudents.map((s) => [
      s.fullName,
      s.email,
      s.present,
      s.absent,
      s.late,
      s.excused,
      s.attendancePercent,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `davamiyyat-${monthlyData.groupName}-${year}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV endirildi");
  };

  const isLoading = dailyLoading || monthlyLoading || gridLoading;
  const hasChanges = useMemo(() => {
    if (!dailyData) return false;
    return dailyData.students.some(
      (s) => (localStatus[s.id] ?? s.status) !== s.status
    );
  }, [dailyData, localStatus]);

  return (
    <div className="page-container pb-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Davamiyyət</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeView("daily")}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              view === "daily"
                ? "bg-primary text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Calendar className="w-4 h-4" />
            Gündəlik
          </button>
          <button
            onClick={() => changeView("monthly")}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              view === "monthly"
                ? "bg-primary text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Aylıq
          </button>
          <button
            onClick={() => changeView("grid")}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              view === "grid"
                ? "bg-primary text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Cədvəl
          </button>
        </div>
      </div>

      {(view === "daily" || view === "monthly") && (
        <div className="mb-4">
          <label className="label">Qrup</label>
          <select
            className="input max-w-xs"
            value={selectedGroupId}
            onChange={(e) => changeGroup(e.target.value)}
          >
            <option value="">Qrup seçin</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* DAILY VIEW */}
      {view === "daily" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div>
              <label className="label">Tarix</label>
              <input
                type="date"
                className="input max-w-[180px]"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  syncUrl({ date: e.target.value });
                }}
              />
            </div>
            {selectedGroupId && dailyData?.students?.length ? (
              <>
                <button
                  onClick={markAllPresent}
                  className="btn-outline mt-6 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Hamısı iştirak
                </button>
                <div className="mt-6 flex-1 min-w-[200px] max-w-xs">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Şagird axtar..."
                      className="input pl-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={() => setFilterStatus("")}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      !filterStatus ? "bg-slate-200" : "bg-slate-100 hover:bg-slate-200"
                    }`}
                  >
                    Hamısı
                  </button>
                  <button
                    onClick={() => setFilterStatus(filterStatus === "absent" ? "" : "absent")}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      filterStatus === "absent" ? "bg-red-200" : "bg-slate-100 hover:bg-slate-200"
                    }`}
                  >
                    Qeyri-iştirak
                  </button>
                  <button
                    onClick={() => setFilterStatus(filterStatus === "late" ? "" : "late")}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      filterStatus === "late" ? "bg-orange-200" : "bg-slate-100 hover:bg-slate-200"
                    }`}
                  >
                    Gecikmə
                  </button>
                </div>
                {selectedIds.size > 0 && (
                  <div className="mt-6 flex items-center gap-2">
                    <select
                      className="input py-1.5 w-36"
                      value={bulkStatus}
                      onChange={(e) => setBulkStatus(e.target.value as AttendanceStatus)}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button onClick={applyBulk} className="btn-primary py-1.5">
                      {selectedIds.size} nəfərə tətbiq et
                    </button>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="p-1.5 hover:bg-slate-100 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {!selectedGroupId ? (
            <div className="card text-center py-16">
              <p className="text-slate-500">Davamiyyət üçün qrup seçin</p>
              <p className="text-sm text-slate-400 mt-1">Qrup seçəndən sonra şagirdlər yüklənəcək</p>
            </div>
          ) : dailyLoading ? (
            <AttendanceTableSkeleton rows={15} />
          ) : dailyData?.students?.length ? (
            <div className="card overflow-hidden">
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
                            filteredDailyStudents.every((s) => selectedIds.has(s.id))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(new Set(filteredDailyStudents.map((s) => s.id)));
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
                        <td colSpan={4} className="py-12 text-center text-slate-500">
                          Axtarış nəticəsi tapılmadı
                        </td>
                      </tr>
                    ) : (
                      filteredDailyStudents.map((student, idx) => {
                        const status = localStatus[student.id] ?? student.status;
                        return (
                          <tr
                            key={student.id}
                            className={`border-b border-slate-100 hover:bg-slate-50/80 ${
                              STATUS_ROW_BG[status] || ""
                            } ${idx % 2 === 1 ? "bg-slate-50/30" : ""}`}
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
                                  const val = e.target.value as AttendanceStatus;
                                  setLocalStatus((prev) => ({ ...prev, [student.id]: val }));
                                }}
                                className={`w-full rounded-lg border py-2 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                                  STATUS_OPTIONS.find((o) => o.value === status)?.border || "border-slate-300"
                                } ${STATUS_OPTIONS.find((o) => o.value === status)?.bg || "bg-white"}`}
                              >
                                {STATUS_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
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
              {filteredDailyStudents.length > 0 && (
                <p className="text-xs text-slate-500 px-4 py-2 border-t border-slate-100">
                  {filteredDailyStudents.length} şagird
                  {dailyData!.students.length > filteredDailyStudents.length &&
                    ` (${dailyData!.students.length} cəmi)`}
                </p>
              )}
            </div>
          ) : (
            <div className="card text-center py-16">
              <p className="text-slate-500">Bu qrupda şagird tapılmadı</p>
              <p className="text-sm text-slate-400 mt-1">Qrupa şagird əlavə edin</p>
            </div>
          )}

          {/* Sticky save bar */}
          {view === "daily" && selectedGroupId && dailyData?.students?.length && (
            <div
              className={`fixed bottom-0 left-0 right-0 md:left-56 bg-white border-t border-slate-200 shadow-lg px-4 py-3 flex items-center justify-between z-20 transition-opacity ${
                hasChanges ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <p className="text-sm text-slate-600">Dəyişikliklər saxlanılmayıb</p>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? "Saxlanılır..." : "Saxla"}
              </button>
            </div>
          )}
        </>
      )}

      {/* MONTHLY VIEW */}
      {view === "monthly" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (month === 1) {
                    const newYear = year - 1;
                    setYear(newYear);
                    setMonth(12);
                    syncUrl({ year: String(newYear), month: "12" });
                  } else {
                    const newMonth = month - 1;
                    setMonth(newMonth);
                    syncUrl({ month: String(newMonth) });
                  }
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
                  if (month === 12) {
                    const newYear = year + 1;
                    setYear(newYear);
                    setMonth(1);
                    syncUrl({ year: String(newYear), month: "1" });
                  } else {
                    const newMonth = month + 1;
                    setMonth(newMonth);
                    syncUrl({ month: String(newMonth) });
                  }
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            {monthlyData && (
              <button
                onClick={exportCsv}
                className="btn-outline flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                CSV endir
              </button>
            )}
          </div>

          {!selectedGroupId ? (
            <div className="card text-center py-16 text-slate-500">
              Qrup seçin
            </div>
          ) : monthlyLoading ? (
            <AttendanceTableSkeleton rows={12} />
          ) : monthlyData?.students?.length ? (
            <div className="card overflow-x-auto">
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white z-10 shadow-sm">
                    <tr className="border-b border-slate-200">
                      <th className="sticky left-0 bg-white z-20 text-left py-3 px-4">
                        <button
                          onClick={() => {
                            setSortKey("fullName");
                            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          }}
                          className="flex items-center gap-1 font-semibold text-slate-700"
                        >
                          Şagird <ArrowUpDown className="w-4 h-4" />
                        </button>
                      </th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-700 min-w-[70px]">
                        İştirak
                      </th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-700 min-w-[90px]">
                        Qeyri-iştirak
                      </th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-700 min-w-[70px]">
                        Gecikmə
                      </th>
                      <th className="text-center py-3 px-4 font-semibold text-slate-700 min-w-[70px]">
                        Bəhanəli
                      </th>
                      <th className="sticky right-0 bg-white z-20 text-center py-3 px-4 min-w-[90px]">
                        <button
                          onClick={() => {
                            setSortKey("attendancePercent");
                            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          }}
                          className="flex items-center justify-center gap-1 w-full font-semibold text-slate-700"
                        >
                          % <ArrowUpDown className="w-4 h-4" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMonthlyStudents.map((s) => (
                      <tr
                        key={s.id}
                        className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${
                          s.attendancePercent < 75 ? "bg-red-50/50" : ""
                        }`}
                        onClick={() =>
                          setBreakdownStudent({
                            id: s.id,
                            fullName: s.fullName,
                            attendancePercent: s.attendancePercent,
                          })
                        }
                      >
                        <td className="sticky left-0 bg-inherit py-3 px-4 font-medium text-slate-900">
                          {s.fullName}
                        </td>
                        <td className="py-3 px-4 text-center text-green-600">
                          {s.present}
                        </td>
                        <td className="py-3 px-4 text-center text-red-600">
                          {s.absent}
                        </td>
                        <td className="py-3 px-4 text-center text-orange-600">
                          {s.late}
                        </td>
                        <td className="py-3 px-4 text-center text-blue-600">
                          {s.excused}
                        </td>
                        <td
                          className={`sticky right-0 bg-inherit py-3 px-4 text-center font-semibold ${
                            s.attendancePercent < 75 ? "text-red-600" : ""
                          }`}
                        >
                          {s.attendancePercent}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card text-center py-16 text-slate-500">
              Bu qrupda şagird və ya məlumat tapılmadı
            </div>
          )}

          {/* Daily breakdown modal */}
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
            {breakdownStudent && breakdownData && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Davamiyyət: {breakdownStudent.attendancePercent}%
                </p>
                <div className="grid grid-cols-7 gap-1">
                  {breakdownData.records.map((r) => (
                    <div
                      key={r.date}
                      className="aspect-square flex flex-col items-center justify-center rounded text-xs"
                      title={`${r.date}: ${r.status || "-"}`}
                    >
                      <span className="text-slate-400">
                        {new Date(r.date).getDate()}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full mt-0.5 ${
                          r.status === "present"
                            ? "bg-green-500"
                            : r.status === "absent"
                            ? "bg-red-500"
                            : r.status === "late"
                            ? "bg-orange-500"
                            : r.status === "excused"
                            ? "bg-blue-500"
                            : "bg-slate-200"
                        }`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500" /> İştirak
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" /> Qeyri-iştirak
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-orange-500" /> Gecikmə
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" /> Bəhanəli
                  </span>
                </div>
              </div>
            )}
          </Modal>
        </>
      )}

      {/* GRID VIEW */}
      {view === "grid" && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={() => {
                if (month === 1) {
                  const newYear = year - 1;
                  setYear(newYear);
                  setMonth(12);
                  syncUrl({ year: String(newYear), month: "12" });
                } else {
                  const newMonth = month - 1;
                  setMonth(newMonth);
                  syncUrl({ month: String(newMonth) });
                }
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
                if (month === 12) {
                  const newYear = year + 1;
                  setYear(newYear);
                  setMonth(1);
                  syncUrl({ year: String(newYear), month: "1" });
                } else {
                  const newMonth = month + 1;
                  setMonth(newMonth);
                  syncUrl({ month: String(newMonth) });
                }
              }}
              className="p-2 rounded-lg hover:bg-slate-100"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {gridLoading ? (
            <AttendanceTableSkeleton rows={10} />
          ) : gridData?.groups?.length ? (
            <div className="space-y-6 overflow-x-auto">
              {gridData.groups.map((group) => (
                <div key={group.id} className="card overflow-x-auto">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">
                    {group.name}
                  </h3>
                  <table className="w-full border-collapse min-w-[600px]">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-3 text-sm font-semibold text-slate-700 sticky left-0 bg-white">
                          Şagird
                        </th>
                        {gridData.dates.map((d: string) => (
                          <th
                            key={d}
                            className="py-2 px-2 text-xs font-medium text-slate-600 text-center w-20"
                          >
                            {new Date(d).getDate()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.students.map((student) => (
                        <tr
                          key={student.id}
                          className="border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="py-2 px-3 text-sm text-slate-900 font-medium sticky left-0 bg-white">
                            {student.fullName}
                          </td>
                          {gridData.dates.map((dateStr: string) => {
                            const current = student.records[dateStr] ?? null;
                            return (
                              <td
                                key={dateStr}
                                className="py-1 px-1 text-center"
                              >
                                <select
                                  value={current || ""}
                                  onChange={(e) => {
                                    const val = e.target
                                      .value as AttendanceStatus | "";
                                    if (val) {
                                      updateMutation.mutate({
                                        groupId: group.id,
                                        studentId: student.id,
                                        date: dateStr,
                                        status: val,
                                      });
                                    }
                                  }}
                                  className="w-full text-xs border border-slate-200 rounded py-1 px-2 bg-white"
                                >
                                  <option value="">-</option>
                                  {STATUS_OPTIONS.map((s) => (
                                    <option key={s.value} value={s.value}>
                                      {s.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center py-16">
              <p className="text-slate-500">Qrup tapılmadı və ya şagird yoxdur</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
