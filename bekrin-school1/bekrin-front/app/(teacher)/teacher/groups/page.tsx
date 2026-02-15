"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, Group } from "@/lib/teacher";
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

const groupSchema = z.object({
  name: z.string().min(1, "Qrup adı tələb olunur"),
});

type GroupFormValues = z.infer<typeof groupSchema>;

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
    mutationFn: (name: string) => teacherApi.createGroup(name),
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
  } = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema),
  });

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
    reset({ name: group.name });
  };

  const onSubmit = (values: GroupFormValues) => {
    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup.id, data: values });
    } else {
      createMutation.mutate(values.name);
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
              reset();
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
                    {group.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className="w-4 h-4" />
                    <span>{group.studentCount || 0} şagird</span>
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
        title={`${groupDetail?.name} - Ətraflı Məlumat`}
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
