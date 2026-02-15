"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { teacherApi, Payment, Student, Group } from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";

const paymentSchema = z.object({
  studentId: z.string().min(1, "Şagird seçilməlidir"),
  groupId: z.string().optional(),
  amount: z.number().min(0.01, "Məbləğ 0-dan böyük olmalıdır"),
  date: z.string().min(1, "Tarix seçilməlidir"),
  method: z.enum(["cash", "card", "bank"]),
  status: z.enum(["paid", "pending"]),
  note: z.string().optional(),
});

type PaymentFormValues = z.infer<typeof paymentSchema>;

export default function PaymentsPage() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [filters, setFilters] = useState<{
    groupId?: string;
    studentId?: string;
  }>({});
  const queryClient = useQueryClient();

  const { data: payments, isLoading } = useQuery({
    queryKey: ["teacher", "payments", filters],
    queryFn: () => teacherApi.getPayments(filters),
  });

  const { data: students } = useQuery({
    queryKey: ["teacher", "students", "active"],
    queryFn: () => teacherApi.getStudents("active"),
  });

  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
  });

  const createMutation = useMutation({
    mutationFn: (data: PaymentFormValues) => teacherApi.createPayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "payments"] });
      setShowAddModal(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deletePayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "payments"] });
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
  });

  const onSubmit = (values: PaymentFormValues) => {
    createMutation.mutate(values);
    reset();
  };

  const methodLabels: Record<string, string> = {
    cash: "Nəğd",
    card: "Kart",
    bank: "Bank köçürməsi",
  };

  const statusLabels: Record<string, string> = {
    paid: "Ödənilib",
    pending: "Gözləyir",
  };

  if (isLoading) return <Loading />;

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Ödənişlər</h1>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Yeni Ödəniş
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Qrup</label>
            <select
              className="input"
              value={filters.groupId || ""}
              onChange={(e) =>
                setFilters({ ...filters, groupId: e.target.value || undefined })
              }
            >
              <option value="">Hamısı</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Şagird</label>
            <select
              className="input"
              value={filters.studentId || ""}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  studentId: e.target.value || undefined,
                })
              }
            >
              <option value="">Hamısı</option>
              {students?.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Tarix
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Şagird
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Qrup
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Ödəniş №
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Məbləğ
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Üsul
              </th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                Status
              </th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">
                Əməliyyatlar
              </th>
            </tr>
          </thead>
          <tbody>
            {payments && payments.length > 0 ? (
              payments.map((payment) => (
                <tr
                  key={payment.id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {new Date(payment.date).toLocaleDateString("az-AZ")}
                  </td>
                  <td className="py-3 px-4 text-sm font-medium text-slate-900">
                    {payment.studentName || "-"}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {payment.groupName || "-"}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {payment.paymentNumber || "-"}
                  </td>
                  <td className="py-3 px-4 text-sm font-medium text-slate-900">
                    {payment.amount.toFixed(2)} ₼
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {methodLabels[payment.method]}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <span
                      className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                        payment.status === "paid"
                          ? "bg-green-100 text-green-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {statusLabels[payment.status]}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => {
                          if (
                            confirm("Bu ödənişi silmək istədiyinizə əminsiniz?")
                          ) {
                            deleteMutation.mutate(payment.id);
                          }
                        }}
                        className="p-2 hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  Ödəniş tapılmadı
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Payment Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          reset();
        }}
        title="Yeni Ödəniş"
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Şagird *</label>
            <select className="input" {...register("studentId")}>
              <option value="">Seçin</option>
              {students?.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </select>
            {errors.studentId && (
              <p className="mt-1 text-xs text-red-600">
                {errors.studentId.message}
              </p>
            )}
          </div>

          <div>
            <label className="label">Qrup</label>
            <select className="input" {...register("groupId")}>
              <option value="">Seçin</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Məbləğ *</label>
              <input
                type="number"
                step="0.01"
                className="input"
                {...register("amount", { valueAsNumber: true })}
              />
              {errors.amount && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.amount.message}
                </p>
              )}
            </div>

            <div>
              <label className="label">Tarix *</label>
              <input
                type="date"
                className="input"
                {...register("date")}
                defaultValue={new Date().toISOString().split("T")[0]}
              />
              {errors.date && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.date.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Ödəniş Üsulu *</label>
              <select className="input" {...register("method")}>
                <option value="cash">Nəğd</option>
                <option value="card">Kart</option>
                <option value="bank">Bank köçürməsi</option>
              </select>
            </div>

            <div>
              <label className="label">Status *</label>
              <select className="input" {...register("status")}>
                <option value="paid">Ödənilib</option>
                <option value="pending">Gözləyir</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Qeyd</label>
            <textarea
              className="input"
              rows={3}
              {...register("note")}
            ></textarea>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Yadda saxlanılır..." : "Yadda Saxla"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddModal(false);
                reset();
              }}
              className="btn-outline flex-1"
            >
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
