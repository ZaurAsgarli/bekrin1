"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parentApi, Child } from "@/lib/parent";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { CalendarCheck, CreditCard, FileText } from "lucide-react";

export default function ParentDashboard() {
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [showTestsModal, setShowTestsModal] = useState(false);
  const [showExamsModal, setShowExamsModal] = useState(false);
  const [paymentsChildId, setPaymentsChildId] = useState<string | null>(null);
  const [testsChildId, setTestsChildId] = useState<string | null>(null);
  const [examsChildId, setExamsChildId] = useState<string | null>(null);
  const [selectedExamAttempt, setSelectedExamAttempt] = useState<{ examId: number; attemptId: number } | null>(null);

  const { data: children, isLoading } = useQuery({
    queryKey: ["parent", "children"],
    queryFn: () => parentApi.getChildren(),
  });

  const { data: payments } = useQuery({
    queryKey: ["parent", "payments", paymentsChildId],
    queryFn: () => parentApi.getChildPayments(paymentsChildId!),
    enabled: !!paymentsChildId && showPaymentsModal,
  });

  const { data: testResults } = useQuery({
    queryKey: ["parent", "test-results", testsChildId],
    queryFn: () => parentApi.getChildTestResults(testsChildId!),
    enabled: !!testsChildId && showTestsModal,
  });
  const { data: examResults = [] } = useQuery({
    queryKey: ["parent", "exam-results", examsChildId],
    queryFn: () => parentApi.getChildExamResults(examsChildId!),
    enabled: !!examsChildId && showExamsModal,
  });
  const { data: examAttemptDetail } = useQuery({
    queryKey: ["parent", "exam-attempt", selectedExamAttempt?.examId, selectedExamAttempt?.attemptId, examsChildId],
    queryFn: () => parentApi.getChildExamAttemptDetail(selectedExamAttempt!.examId, selectedExamAttempt!.attemptId, examsChildId!),
    enabled: !!selectedExamAttempt && !!examsChildId,
  });

  if (isLoading) {
    return (
      <div className="page-container">
        <Loading />
      </div>
    );
  }

  const handlePaymentsClick = (child: Child) => {
    setPaymentsChildId(child.id);
    setShowPaymentsModal(true);
  };

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Valideyn Paneli
        </h1>
        <p className="text-slate-600">
          Uşaqlarınızın təhsil prosesini izləyin
        </p>
      </div>

      {children && children.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {children.map((child) => (
            <div key={child.id} className="card hover:shadow-lg transition-all">
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-slate-200">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-semibold">
                  {child.fullName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {child.fullName}
                  </h3>
                  <p className="text-sm text-slate-600">
                    {child.class ? `Sinif: ${child.class}` : "-"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Davamiyyət %</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {child.attendancePercent !== undefined
                      ? `${child.attendancePercent}%`
                      : "-"}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Balans</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {child.balance.toFixed(2)} ₼
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Son Test</p>
                  <p className="text-sm font-medium text-slate-900">
                    {child.lastTest
                      ? `${child.lastTest.score}/${child.lastTest.maxScore}`
                      : "-"}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">
                    Kodlaşdırma
                  </p>
                  <p className="text-2xl font-bold text-slate-900">
                    {child.codingSolvedCount != null && child.codingTotalTasks != null
                      ? `${child.codingSolvedCount} / ${child.codingTotalTasks}`
                      : "-"}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {child.codingPercent != null ? `${child.codingPercent}%` : child.codingLastActivity ? `Son: ${new Date(child.codingLastActivity).toLocaleDateString("az-AZ")}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <a
                  href={`/parent/attendance?studentId=${child.id}`}
                  className="flex-1 btn-outline text-center"
                >
                  <CalendarCheck className="w-4 h-4 inline mr-2" />
                  Davamiyyət
                </a>
                <button
                  onClick={() => handlePaymentsClick(child)}
                  className="flex-1 btn-outline"
                >
                  <CreditCard className="w-4 h-4 inline mr-2" />
                  Ödənişlər
                </button>
                <button
                  onClick={() => {
                    setTestsChildId(child.id);
                    setShowTestsModal(true);
                  }}
                  className="flex-1 btn-outline"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  Testlər
                </button>
                <button
                  onClick={() => {
                    setExamsChildId(child.id);
                    setShowExamsModal(true);
                    setSelectedExamAttempt(null);
                  }}
                  className="flex-1 btn-outline"
                >
                  <FileText className="w-4 h-4 inline mr-2" />
                  İmtahanlar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <p className="text-slate-500 mb-2">Hələ şagird əlavə edilməyib</p>
          <p className="text-sm text-slate-400">
            Məktəb administrasiyası ilə əlaqə saxlayın
          </p>
        </div>
      )}

      {/* Tests Modal */}
      <Modal
        isOpen={showTestsModal}
        onClose={() => {
          setShowTestsModal(false);
          setTestsChildId(null);
        }}
        title="Test Nəticələri"
        size="lg"
      >
        {testResults && testResults.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Test Adı
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Xal
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Tarix
                  </th>
                </tr>
              </thead>
              <tbody>
                {testResults.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">
                      {r.testName}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-900">
                      {r.score} / {r.maxScore}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(r.date).toLocaleDateString("az-AZ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            Test nəticəsi tapılmadı
          </div>
        )}
      </Modal>

      {/* Exams Modal */}
      <Modal
        isOpen={showExamsModal}
        onClose={() => {
          setShowExamsModal(false);
          setExamsChildId(null);
          setSelectedExamAttempt(null);
        }}
        title={selectedExamAttempt && examAttemptDetail ? examAttemptDetail.title : "İmtahan Nəticələri"}
        size="lg"
      >
        {selectedExamAttempt && examAttemptDetail ? (
          <div className="space-y-4">
            <p className="text-lg font-semibold text-green-700">Yekun: {examAttemptDetail.score}</p>
            {examAttemptDetail.canvases && examAttemptDetail.canvases.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Situasiya qaralamaları</h4>
                <div className="space-y-3">
                  {examAttemptDetail.canvases.map((c) => c.imageUrl && (
                    <div key={c.canvasId}>
                      <img
                        src={c.imageUrl}
                        alt={`Sual ${c.questionId} qaralama`}
                        className="max-w-full max-h-64 rounded border border-slate-200"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSelectedExamAttempt(null)}
              className="btn-outline"
            >
              Geri
            </button>
          </div>
        ) : examResults.length > 0 ? (
          <ul className="space-y-2">
            {examResults.map((r) => (
              <li key={r.attemptId} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="font-medium text-slate-900">{r.title}</span>
                <div className="flex items-center gap-3">
                  {r.is_result_published && r.score != null ? (
                    <span className="text-sm text-slate-600">{r.score} / {r.maxScore ?? "—"}</span>
                  ) : (
                    <span className="text-sm text-amber-600">Yoxlanılır / Nəticə yayımda deyil</span>
                  )}
                  {r.is_result_published && (
                    <button
                      type="button"
                      onClick={() => setSelectedExamAttempt({ examId: r.examId, attemptId: r.attemptId })}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Bax
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-12 text-slate-500">İmtahan nəticəsi tapılmadı</div>
        )}
      </Modal>

      {/* Payments Modal */}
      <Modal
        isOpen={showPaymentsModal}
        onClose={() => {
          setShowPaymentsModal(false);
          setPaymentsChildId(null);
        }}
        title="Ödənişlər"
        size="lg"
      >
        {payments && payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">
                    Tarix
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
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr
                    key={payment.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {new Date(payment.date).toLocaleDateString("az-AZ")}
                    </td>
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">
                      {payment.amount.toFixed(2)} ₼
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {payment.method === "cash"
                        ? "Nəğd"
                        : payment.method === "card"
                        ? "Kart"
                        : "Bank köçürməsi"}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                          payment.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {payment.status === "paid" ? "Ödənilib" : "Gözləyir"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            Ödəniş tapılmadı
          </div>
        )}
      </Modal>
    </div>
  );
}
