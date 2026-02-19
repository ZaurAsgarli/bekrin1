"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, Group, LESSON_DAY_LABELS, deriveDisplayNameFromDays } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Edit2, Trash2, Users, Key } from "lucide-react";

function GroupDetailContent({
  groupId,
  groupName,
  studentCount,
  onUpdate,
}: {
  groupId: string;
  groupName: string;
  studentCount: number;
  onUpdate: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: groupStudents, isLoading } = useQuery({
    queryKey: ["teacher", "group-students", groupId],
    queryFn: () => teacherApi.getGroupStudents(groupId),
    enabled: !!groupId,
  });
  const { data: allStudents } = useQuery({
    queryKey: ["teacher", "students", "active"],
    queryFn: () => teacherApi.getStudents("active"),
  });
  const [addStudentId, setAddStudentId] = useState("");
  const addMutation = useMutation({
    mutationFn: (studentIds: string[]) =>
      teacherApi.addStudentsToGroup(groupId, studentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "group-students", groupId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      setAddStudentId("");
      onUpdate();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (studentId: string) =>
      teacherApi.removeStudentFromGroup(groupId, studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "group-students", groupId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      onUpdate();
    },
  });
  const inGroupIds = new Set((groupStudents || []).map((s) => s.id));
  const availableStudents = (allStudents || []).filter((s) => !inGroupIds.has(s.id));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-600 mb-2">Qrup adı</p>
        <p className="font-medium text-slate-900">{groupName}</p>
      </div>
      <div>
        <p className="text-sm text-slate-600 mb-2">Şagird sayı</p>
        <p className="font-medium text-slate-900">{studentCount}</p>
      </div>
      <Link
        href={`/teacher/credentials?group_id=${groupId}`}
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <Key className="w-4 h-4" />
        Bu qrup üçün hesab məlumatları
      </Link>
      <div className="pt-4 border-t border-slate-200">
        <p className="text-sm font-medium text-slate-700 mb-3">Şagirdlər</p>
        {isLoading ? (
          <Loading />
        ) : (
          <>
            <div className="flex gap-2 mb-4">
              <select
                className="input flex-1"
                value={addStudentId}
                onChange={(e) => setAddStudentId(e.target.value)}
              >
                <option value="">Şagird əlavə et...</option>
                {availableStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} ({s.email})
                  </option>
                ))}
              </select>
              <button
                className="btn-primary"
                disabled={!addStudentId || addMutation.isPending}
                onClick={() => {
                  if (addStudentId) {
                    addMutation.mutate([addStudentId]);
                  }
                }}
              >
                Əlavə et
              </button>
            </div>
            {groupStudents && groupStudents.length > 0 ? (
              <ul className="space-y-2">
                {groupStudents.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between py-2 border-b border-slate-100"
                  >
                    <span className="text-sm text-slate-900">
                      {s.fullName} ({s.email})
                    </span>
                    <button
                      onClick={() => {
                        if (confirm(`"${s.fullName}" şagirdini qrupdan çıxarmaq?`)) {
                          removeMutation.mutate(s.id);
                        }
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Çıxar
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Bu qrupda şagird yoxdur</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const groupSchema = z
  .object({
    name: z.string().min(1, "Qrup adı tələb olunur"),
    lesson_days: z.array(z.number().min(1).max(7)).optional(),
    start_time: z.string().optional(),
    display_name: z.string().optional(),
    display_name_is_manual: z.boolean().optional(),
    monthly_fee: z.number().min(0).optional().nullable(),
    monthly_lessons_count: z.number().int().min(1).optional(),
  })
  .refine(
    (data) => !data.lesson_days || data.lesson_days.length >= 1,
    { message: "Ən azı bir dərs günü seçilməlidir", path: ["lesson_days"] }
  );

type GroupFormValues = z.infer<typeof groupSchema>;

const WEEKDAY_KEYS = [1, 2, 3, 4, 5, 6, 7] as const;

export default function GroupsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupIdParam = searchParams.get("group");
  const [editMode, setEditMode] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupDetail, setGroupDetail] = useState<Group | null>(null);
  const queryClient = useQueryClient();

  const { data: groups, isLoading } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; lesson_days?: number[]; start_time?: string | null; display_name?: string | null; display_name_is_manual?: boolean; monthly_fee?: number | null; monthly_lessons_count?: number }) =>
      teacherApi.createGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      setEditingGroup(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Group> }) =>
      teacherApi.updateGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
      setEditingGroup(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    setValue,
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: "",
      lesson_days: [2, 4],
      start_time: "11:00",
      display_name: "",
      display_name_is_manual: false,
      monthly_fee: null,
      monthly_lessons_count: 8,
    },
  });

  const watchedLessonDays = watch("lesson_days") ?? [];
  const watchedDisplayNameIsManual = watch("display_name_is_manual") ?? false;
  const watchedStartTime = watch("start_time");

  useEffect(() => {
    if (!watchedDisplayNameIsManual && Array.isArray(watchedLessonDays) && watchedLessonDays.length > 0) {
      const derived = deriveDisplayNameFromDays(watchedLessonDays, watchedStartTime);
      setValue("display_name", derived, { shouldDirty: false });
    }
  }, [watchedDisplayNameIsManual, watchedLessonDays, watchedStartTime, setValue]);

  useEffect(() => {
    if (!groupIdParam) {
      setGroupDetail(null);
      return;
    }
    if (groups && groups.length > 0) {
      const g = groups.find((gr) => gr.id === groupIdParam);
      setGroupDetail(g || null);
    }
  }, [groupIdParam, groups]);

  const openGroupDetail = (group: Group) => {
    setGroupDetail(group);
    const params = new URLSearchParams(searchParams.toString());
    params.set("group", group.id);
    router.replace(`/teacher/groups?${params.toString()}`, { scroll: false });
  };

  const closeGroupDetail = () => {
    setGroupDetail(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("group");
    const qs = params.toString();
    router.replace(qs ? `/teacher/groups?${qs}` : "/teacher/groups", {
      scroll: false,
    });
  };

  const handleEdit = (group: Group) => {
    setEditingGroup(group);
    const st = group.start_time;
    const timeVal = st && /^\d{2}:\d{2}/.test(st) ? st.slice(0, 5) : "11:00";
    reset({
      name: group.name,
      lesson_days: group.lesson_days?.length ? group.lesson_days : [2, 4],
      start_time: timeVal,
      display_name: group.display_name ?? "",
      display_name_is_manual: group.display_name_is_manual ?? false,
      monthly_fee: (group as any).monthly_fee ?? null,
      monthly_lessons_count: (group as any).monthly_lessons_count ?? 8,
    });
  };

  const toggleLessonDay = (day: number) => {
    const current = watch("lesson_days") ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setValue("lesson_days", next, { shouldValidate: true });
  };

  const onSubmit = (values: GroupFormValues) => {
    if (editingGroup?.id) {
      updateMutation.mutate({
        id: editingGroup.id,
        data: {
          name: values.name,
          lesson_days: values.lesson_days?.length ? values.lesson_days : undefined,
          start_time: values.start_time ? `${values.start_time}:00` : undefined,
          display_name: values.display_name || undefined,
          display_name_is_manual: values.display_name_is_manual ?? false,
          monthly_fee: values.monthly_fee ?? undefined,
          monthly_lessons_count: values.monthly_lessons_count ?? undefined,
        },
      });
    } else {
      createMutation.mutate({
        name: values.name,
        lesson_days: values.lesson_days?.length ? values.lesson_days : [2, 4],
        start_time: values.start_time ? `${values.start_time}:00` : undefined,
        display_name: values.display_name || undefined,
        display_name_is_manual: values.display_name_is_manual ?? false,
        monthly_fee: values.monthly_fee ?? undefined,
        monthly_lessons_count: values.monthly_lessons_count ?? undefined,
      });
      reset();
    }
  };

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Qruplar</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editMode}
              onChange={(e) => setEditMode(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-slate-700">Düzəliş rejimi</span>
          </label>
          <button
            onClick={() => {
              setEditingGroup({ id: "", name: "", studentCount: 0 } as Group);
              reset({
                name: "",
                lesson_days: [2, 4],
                start_time: "11:00",
                display_name: deriveDisplayNameFromDays([2, 4], "11:00"),
                display_name_is_manual: false,
                monthly_fee: null,
                monthly_lessons_count: 8,
              });
            }}
            className="btn-primary"
          >
            Yeni Qrup
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups && groups.length > 0 ? (
          groups.map((group) => (
            <div
              key={group.id}
              className="card hover:shadow-lg transition-all cursor-pointer"
              onClick={() => !editMode && openGroupDetail(group)}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    {group.display_name || group.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className="w-4 h-4" />
                    <span>{group.studentCount || 0} şagird</span>
                    {(!group.lesson_days || group.lesson_days.length === 0) && (
                      <span className="text-amber-600 text-xs" title="Dərs günləri təyin edilməyib. Qrup ayarlarından seçin.">
                        ⚠ Dərs günü yoxdur
                      </span>
                    )}
                  </div>
                </div>
                {editMode && (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(group);
                      }}
                      className="p-2 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(
                            `"${group.name}" qrupunu silmək istədiyinizə əminsiniz?`
                          )
                        ) {
                          deleteMutation.mutate(group.id);
                        }
                      }}
                      className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {!editMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openGroupDetail(group);
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  Ətraflı bax →
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-500">
            Qrup tapılmadı
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={!!editingGroup}
        onClose={() => setEditingGroup(null)}
        title={editingGroup?.id ? "Qrup Redaktə Et" : "Yeni Qrup"}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Qrup Adı *</label>
            <input
              type="text"
              className="input"
              placeholder="Məs: 9A, 10B"
              {...register("name")}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="label">Başlama vaxtı</label>
            <input
              type="time"
              className="input w-32"
              {...register("start_time")}
            />
          </div>

          <div>
            <label className="label">Dərs günləri</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {WEEKDAY_KEYS.map((day) => {
                const selected = Array.isArray(watchedLessonDays) && watchedLessonDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleLessonDay(day)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selected
                        ? "bg-primary text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {LESSON_DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
            {errors.lesson_days && (
              <p className="mt-1 text-xs text-red-600">{errors.lesson_days.message}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!watchedDisplayNameIsManual}
                onChange={(e) => setValue("display_name_is_manual", !e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Adı avtomatik yarat</span>
            </label>
            <span className="text-xs text-slate-500">
              {watchedDisplayNameIsManual ? "Adı əl ilə yazın" : "Dərs günlərinə görə avtomatik"}
            </span>
          </div>

          <div>
            <label className="label">Qrup göstərici adı</label>
            <input
              type="text"
              className="input"
              placeholder="Məs: 1-4 11:00"
              {...register("display_name")}
              readOnly={!watchedDisplayNameIsManual}
              disabled={!watchedDisplayNameIsManual}
              style={{ opacity: watchedDisplayNameIsManual ? 1 : 0.7 }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200">
            <div>
              <label className="label">Aylıq haqq (AZN)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                placeholder="Məs: 100"
                {...register("monthly_fee", { valueAsNumber: true })}
              />
              <p className="mt-1 text-xs text-slate-500">
                Real ödəniş məbləği (parent view)
              </p>
            </div>
            <div>
              <label className="label">Ayda dərs sayı</label>
              <input
                type="number"
                min="1"
                className="input"
                placeholder="8"
                {...register("monthly_lessons_count", { valueAsNumber: true })}
              />
              <p className="mt-1 text-xs text-slate-500">
                Hər dərs üçün: aylıq haqq / dərs sayı
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Yadda saxlanılır..."
                : "Yadda Saxla"}
            </button>
            <button
              type="button"
              onClick={() => setEditingGroup(null)}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Group Detail Modal */}
      <Modal
        isOpen={!!groupDetail}
        onClose={closeGroupDetail}
        title={`${groupDetail?.display_name || groupDetail?.name} - Ətraflı Məlumat`}
        size="lg"
      >
        {groupDetail && (
          <GroupDetailContent
            groupId={groupDetail.id}
            groupName={groupDetail.name}
            studentCount={groupDetail.studentCount || 0}
            onUpdate={() => {
              queryClient.invalidateQueries({ queryKey: ["teacher", "groups"] });
              queryClient.invalidateQueries({ queryKey: ["teacher", "group-students", groupDetail.id] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
