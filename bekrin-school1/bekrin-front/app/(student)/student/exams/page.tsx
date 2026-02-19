"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { studentApi } from "@/lib/student";
import { Loading } from "@/components/Loading";
import { CanvasPad } from "@/components/exam/CanvasPad";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Send, Clock, Eye, AlertCircle } from "lucide-react";

const LABELS = ["A", "B", "C", "D", "E", "F"];

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function ExamResultsSection() {
  const [selectedResult, setSelectedResult] = useState<{ examId: number; attemptId: number } | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "quiz" | "exam">("all");
  const { data: results = [] } = useQuery({
    queryKey: ["student", "exam-results", typeFilter],
    queryFn: () => studentApi.getMyExamResults(typeFilter !== "all" ? { type: typeFilter } : undefined),
  });
  const { data: resultDetail } = useQuery({
    queryKey: ["student", "exam-result", selectedResult?.examId, selectedResult?.attemptId],
    queryFn: () => studentApi.getExamResult(selectedResult!.examId, selectedResult!.attemptId),
    enabled: selectedResult != null,
  });
  if (results.length === 0) return null;
  return (
    <>
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Quiz nəticələrim</h2>
          <div className="flex gap-2">
            {(["all", "quiz", "exam"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded text-sm ${typeFilter === t ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                {t === "all" ? "Hamısı" : t === "quiz" ? "Quiz" : "İmtahan"}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.attemptId} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
              <span className="font-medium text-slate-900">{r.title}</span>
              <div className="flex items-center gap-3">
                {r.is_result_published && r.score != null ? (
                  <span className="text-sm text-slate-600">{r.score} / {r.maxScore}</span>
                ) : (
                  <span className="text-sm text-amber-600">Yoxlanılır / Nəticə yayımda deyil</span>
                )}
                {r.is_result_published && (
                  <button
                    type="button"
                    onClick={() => setSelectedResult({ examId: r.examId, attemptId: r.attemptId })}
                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye className="w-4 h-4" /> Bax
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Modal
        isOpen={!!selectedResult}
        onClose={() => setSelectedResult(null)}
        title={resultDetail?.title ?? "Nəticə"}
        size="lg"
      >
        {resultDetail && (
          <div className="space-y-4">
            <p className="text-lg font-semibold text-green-700">
              {resultDetail.score != null ? `Yekun: ${resultDetail.score}` : "Yoxlanılır / Nəticə yayımda deyil"}
            </p>
            {resultDetail.canvases && resultDetail.canvases.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-700 mb-2">Situasiya qaralamaları</h4>
                <div className="space-y-3">
                  {resultDetail.canvases.map((c) => c.imageUrl && (
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
          </div>
        )}
      </Modal>
    </>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type StartedQuestion = {
  examQuestionId?: number;
  questionId?: number;
  questionNumber?: number;
  order?: number;
  text: string;
  type: string;
  kind?: string;
  prompt?: string;
  options: { id?: number; key?: string; text: string; order?: number }[];
};

export default function StudentExamsPage() {
  const [startedExam, setStartedExam] = useState<{
    attemptId: number;
    examId: number;
    runId?: number;
    title: string;
    endTime: string;
    expiresAt?: string;
    status?: string;
    sourceType?: string;
    pdfUrl?: string | null;
    questions: StartedQuestion[];
    canvases?: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }[];
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, { selectedOptionId?: number | string; selectedOptionKey?: string; textAnswer?: string }>>({});
  const [submitted, setSubmitted] = useState<{ autoScore: number; maxScore: number } | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [expired, setExpired] = useState(false);
  const [reviewDisabledMessage, setReviewDisabledMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const expiresAt = startedExam?.expiresAt ?? startedExam?.endTime;
  const [countdownMs, setCountdownMs] = useState(0);
  useEffect(() => {
    if (!expiresAt || submitted) return;
    const update = () => {
      const left = new Date(expiresAt).getTime() - Date.now();
      if (left <= 0) {
        setCountdownMs(0);
        setExpired(true);
        return;
      }
      setCountdownMs(left);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt, submitted]);

  useEffect(() => {
    if (!expired || !startedExam || submitted || startedExam.questions.length === 0) return;
    submitMutation.mutate();
  }, [expired]);

  const { data: exams, isLoading } = useQuery({
    queryKey: ["student", "exams"],
    queryFn: () => studentApi.getExams(),
  });

  const startMutation = useMutation({
    mutationFn: (runId: number) => studentApi.startRun(runId),
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("Already submitted") || msg.toLowerCase().includes("already submitted")) {
        toast.info("Bu imtahan artıq təhvil verilib.");
        return;
      }
      if (msg.includes("yoxlaması söndürülüb")) {
        toast.info("İmtahan yoxlaması söndürülüb.");
        return;
      }
      toast.error(msg || "İmtahan başladılmadı.");
    },
    onSuccess: (data) => {
      setReviewDisabledMessage(null);
      if (data.status === "EXPIRED" || (data.questions?.length ?? 0) === 0) {
        setStartedExam({
          attemptId: data.attemptId,
          examId: data.examId,
          runId: data.runId,
          title: data.title,
          endTime: data.endTime ?? "",
          expiresAt: data.expiresAt ?? data.endTime,
          status: data.status ?? "EXPIRED",
          sourceType: data.sourceType,
          pdfUrl: data.pdfUrl,
          questions: [],
          canvases: data.canvases ?? [],
        });
        setExpired(true);
      } else {
        setStartedExam({
          attemptId: data.attemptId,
          examId: data.examId,
          runId: data.runId,
          title: data.title,
          endTime: data.endTime,
          expiresAt: data.expiresAt ?? data.endTime,
          status: data.status ?? "IN_PROGRESS",
          sourceType: data.sourceType,
          pdfUrl: data.pdfUrl,
          questions: data.questions.map((q) => ({
            ...q,
            options: q.options?.length ? shuffle([...q.options]) : [],
          })),
          canvases: data.canvases ?? [],
        });
        setExpired(false);
      }
      setAnswers({});
      setSubmitted(null);
    },
  });

  const saveCanvasMutation = useMutation({
    mutationFn: ({ attemptId, questionId, situationIndex, imageBase64 }: { attemptId: number; questionId?: number; situationIndex?: number; imageBase64: string }) =>
      studentApi.saveCanvas(attemptId, { questionId, situationIndex, imageBase64 }),
    onSuccess: (_, { questionId, situationIndex }) => {
      setStartedExam((prev) => {
        if (!prev?.canvases) return prev;
        const idx = prev.canvases.findIndex((c) => (questionId != null && c.questionId === questionId) || (situationIndex != null && c.situationIndex === situationIndex));
        const updated = [...prev.canvases];
        if (idx >= 0) updated[idx] = { ...updated[idx], imageUrl: null, updatedAt: new Date().toISOString() };
        return { ...prev, canvases: updated };
      });
    },
  });

  const getAnswerKey = (q: StartedQuestion) => (q.questionId != null ? String(q.questionId) : `n-${q.questionNumber ?? 0}`);

  const handleSaveCanvas = useCallback(
    (questionId?: number, situationIndex?: number) => async (imageBase64: string): Promise<void> => {
      if (!startedExam) throw new Error("No exam");
      await saveCanvasMutation.mutateAsync({ attemptId: startedExam.attemptId, questionId, situationIndex, imageBase64 });
    },
    [startedExam, saveCanvasMutation]
  );

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!startedExam) throw new Error("No exam");
      
      // Final save all canvas pads before submitting
      const canvasElements = document.querySelectorAll('canvas[data-canvas-pad="true"]');
      await Promise.all(
        Array.from(canvasElements).map(async (canvas) => {
          const finalSave = (canvas as any).finalSave;
          if (finalSave && typeof finalSave === 'function') {
            try {
              await finalSave();
            } catch (e) {
              console.warn("Failed to final save canvas", e);
            }
          }
        })
      );
      
      const answersList = startedExam.questions.map((q) => {
        const key = getAnswerKey(q);
        const a = answers[key];
        if (q.questionId != null) {
          return { questionId: q.questionId, selectedOptionId: a?.selectedOptionId ?? null, textAnswer: a?.textAnswer ?? "" };
        }
        return {
          questionNumber: q.questionNumber,
          selectedOptionId: a?.selectedOptionId ?? undefined,
          selectedOptionKey: a?.selectedOptionKey ?? undefined,
          textAnswer: a?.textAnswer ?? "",
        };
      });
      return studentApi.submitExam(startedExam.examId, startedExam.attemptId, answersList);
    },
    onSuccess: (data) => {
      setSubmitted({ autoScore: data.autoScore, maxScore: data.maxScore });
      setShowSubmitModal(false);
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
    },
  });

  if (isLoading) return <Loading />;

  if (reviewDisabledMessage) {
    return (
      <div className="page-container">
        <div className="max-w-[760px] mx-auto">
          <div className="card text-center py-12">
            <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">İmtahan yoxlaması söndürülüb</h1>
            <p className="text-slate-600 mb-4">{reviewDisabledMessage}</p>
            <p className="text-sm text-slate-500">Təhvil verdikdən sonra suallara baxmaq mümkün deyil.</p>
            <button onClick={() => setReviewDisabledMessage(null)} className="btn-primary mt-6">
              Geri qayıt
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (startedExam && !submitted) {
    const isExpiredOrNoQuestions = expired || startedExam.questions.length === 0;
    const closedQuestions = startedExam.questions.filter((q) => q.type === "MULTIPLE_CHOICE" || q.kind === "mc");
    const openQuestions = startedExam.questions.filter((q) =>
      ["OPEN_SINGLE_VALUE", "OPEN_ORDERED", "OPEN_UNORDERED"].includes(q.type) || q.kind === "open"
    );
    const situationQuestions = startedExam.questions.filter((q) => q.type === "SITUATION" || q.kind === "situation");

    if (isExpiredOrNoQuestions) {
      return (
        <div className="page-container">
          <div className="max-w-[760px] mx-auto">
            <div className="card text-center py-12">
              <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
              <h1 className="text-xl font-bold text-slate-900 mb-2">Vaxt bitib / artıq baxmaq olmur</h1>
              <p className="text-slate-600 mb-4">Sual məzmununa artıq daxil olmaq mümkün deyil.</p>
              <p className="text-sm text-slate-500">Nəticə müəllim tərəfindən yoxlanıldıqdan sonra dərc ediləcək.</p>
              <button onClick={() => { setStartedExam(null); setExpired(false); }} className="btn-primary mt-6">
                İmtahanlar siyahısına qayıt
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="page-container">
        <div className="max-w-[900px] mx-auto">
          {/* Top bar */}
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 -mx-4 px-4 py-3 mb-6 flex items-center justify-between gap-4">
            <h1 className="text-lg font-bold text-slate-900 truncate">{startedExam.title}</h1>
            <div className="flex items-center gap-3 shrink-0">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-semibold ${
                  countdownMs < 60000 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-800"
                }`}
              >
                <Clock className="w-4 h-4" />
                {formatCountdown(countdownMs)}
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitModal(true)}
                disabled={submitMutation.isPending}
                className="btn-primary flex items-center gap-2 py-2"
              >
                <Send className="w-4 h-4" />
                Göndər
              </button>
            </div>
          </div>

          {startedExam.pdfUrl && (
              <section className="mb-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-2">İmtahan PDF</h2>
                <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                  <iframe
                    title="İmtahan PDF"
                    src={startedExam.pdfUrl}
                    className="w-full min-h-[480px] max-h-[70vh]"
                  />
                </div>
              </section>
            )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowSubmitModal(true);
            }}
            className="space-y-8"
          >
            {closedQuestions.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Qapalı suallar</h2>
                <div className="space-y-4">
                  {closedQuestions.map((q, idx) => {
                    const key = getAnswerKey(q);
                    const label = (i: number) => (q.options?.[i]?.key != null ? String(q.options[i].key) : LABELS[i] ?? String(i + 1));
                    return (
                      <div key={key} className="card">
                        <p className="font-medium text-slate-900 mb-3">
                          {idx + 1}. {q.text || q.prompt}
                        </p>
                        <ul className="space-y-2">
                          {q.options?.map((opt, optIdx) => (
                            <li key={opt.id ?? opt.key ?? optIdx}>
                              <label className="flex items-center gap-3 cursor-pointer py-1">
                                <span className="font-medium text-slate-700 w-6 shrink-0">{label(optIdx)})</span>
                                <input
                                  type="radio"
                                  name={`q-${key}`}
                                  checked={
                                    opt.id != null
                                      ? answers[key]?.selectedOptionId === opt.id
                                      : answers[key]?.selectedOptionKey === (opt.key ?? label(optIdx))
                                  }
                                  onChange={() =>
                                    setAnswers((prev) => ({
                                      ...prev,
                                      [key]: opt.id != null
                                        ? { ...prev[key], selectedOptionId: opt.id }
                                        : { ...prev[key], selectedOptionKey: opt.key ?? label(optIdx) },
                                    }))
                                  }
                                  className="rounded border-slate-300"
                                />
                                <span>{opt.text}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {openQuestions.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Açıq suallar</h2>
                <div className="space-y-4">
                  {openQuestions.map((q, idx) => {
                    const key = getAnswerKey(q);
                    return (
                      <div key={key} className="card">
                        <p className="font-medium text-slate-900 mb-2">
                          {closedQuestions.length + idx + 1}. {q.text || q.prompt}
                        </p>
                        <textarea
                          className="input w-full h-24"
                          placeholder="Cavabı yazın…"
                          value={answers[key]?.textAnswer ?? ""}
                          onChange={(e) =>
                            setAnswers((prev) => ({ ...prev, [key]: { ...prev[key], textAnswer: e.target.value } }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {situationQuestions.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Situasiya sualları</h2>
                <div className="space-y-4">
                  {situationQuestions.map((q, idx) => {
                    const sitIndex = idx + 1;
                    const canvasForThis = startedExam.canvases?.find(
                      (c) => (q.questionId != null && c.questionId === q.questionId) || (c.situationIndex === sitIndex)
                    );
                    return (
                      <div key={getAnswerKey(q)} className="card">
                        <p className="font-medium text-slate-900 mb-3">
                          {closedQuestions.length + openQuestions.length + idx + 1}. {q.text || q.prompt}
                        </p>
                        <CanvasPad
                          attemptId={startedExam.attemptId}
                          questionId={q.questionId}
                          initialImageUrl={canvasForThis?.imageUrl ?? null}
                          onSave={handleSaveCanvas(q.questionId, q.questionId == null ? sitIndex : undefined)}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={() => setShowSubmitModal(true)} className="btn-primary flex items-center gap-2">
                <Send className="w-4 h-4" />
                Göndər
              </button>
              <button type="button" onClick={() => setStartedExam(null)} className="btn-outline">
                Geri
              </button>
            </div>
          </form>

          <Modal
            isOpen={showSubmitModal}
            onClose={() => setShowSubmitModal(false)}
            title="Təsdiq"
            size="sm"
          >
            <p className="text-slate-600 mb-4">İmtahanı təsdiq etmək istədiyinizə əminsiniz? Göndərildikdən sonra dəyişiklik etmək mümkün olmayacaq.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSubmitModal(false)} className="btn-outline">
                Ləğv et
              </button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {submitMutation.isPending ? "Göndərilir…" : "Təsdiq et"}
              </button>
            </div>
          </Modal>
        </div>
      </div>
    );
  }

  if (startedExam && submitted) {
    return (
      <div className="page-container">
        <div className="card max-w-md mx-auto text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-4">Nəticə</h1>
          <p className="text-2xl font-semibold text-green-700">
            {submitted.autoScore} / {submitted.maxScore}
          </p>
          <p className="text-sm text-slate-500 mt-2">Nəticələr müəllim tərəfindən dərc edildikdən sonra görünəcək.</p>
          <button onClick={() => { setStartedExam(null); setSubmitted(null); }} className="btn-primary mt-4">
            İmtahanlar siyahısına qayıt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">İmtahanlar</h1>
        <p className="text-sm text-slate-600 mt-2">Aktiv imtahanları görürsünüz. Başlatmaq üçün &quot;Başla&quot; düyməsini basın.</p>
      </div>
      <ExamResultsSection />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {exams && exams.length > 0 ? (
          exams.map((exam) => (
            <div key={exam.runId ?? exam.examId} className="card flex flex-col">
              <h3 className="text-lg font-semibold text-slate-900">{exam.title}</h3>
              <p className="text-sm text-slate-500 mt-1">
                {exam.type === "exam" ? "İmtahan" : "Quiz"}
                {exam.remainingSeconds != null && (
                  <span className="ml-2 font-mono text-amber-700">
                    Qalan: {formatCountdown(exam.remainingSeconds * 1000)}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {new Date(exam.startTime).toLocaleString("az-AZ")} - {new Date(exam.endTime).toLocaleString("az-AZ")}
              </p>
              <button
                onClick={() => startMutation.mutate(exam.runId ?? exam.examId)}
                disabled={startMutation.isPending}
                className="btn-primary mt-4 self-start"
              >
                Başla
              </button>
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-500">
            Hal-hazırda aktiv imtahan yoxdur
          </div>
        )}
      </div>
    </div>
  );
}
