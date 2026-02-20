"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/lib/useDebounce";
import {
  teacherApi,
  Test,
  TestResult,
  ExamListItem,
  ExamDetail,
  ExamAttempt,
  ExamAttemptDetail,
  Payment,
} from "@/lib/teacher";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatPaymentDisplay } from "@/lib/formatPayment";
import { Plus, Trash2, Clock, CheckCircle2, Eye, Check, X, StopCircle, RotateCcw, Archive, AlertCircle, ChevronDown, Save, Send } from "lucide-react";

type TabType = "bank" | "active" | "grading" | "archive";
type ArchiveSubTab = "exams" | "questions" | "topics" | "pdfs" | "codingTopics" | "codingTasks" | "payments" | "groups" | "students";

const testSchema = z.object({
  type: z.enum(["quiz", "exam"]),
  title: z.string().min(1, "Başlıq tələb olunur"),
});

const resultSchema = z.object({
  studentProfileId: z.number().min(1, "Şagird seçilməlidir"),
  groupId: z.number().optional(),
  testName: z.string().min(1, "Test adı tələb olunur"),
  maxScore: z.number().min(1, "Maksimum xal tələb olunur"),
  score: z.number().min(0, "Xal 0-dan kiçik ola bilməz"),
  date: z.string().min(1, "Tarix tələb olunur"),
});

const examSchema = z.object({
  title: z.string().min(1, "Başlıq tələb olunur"),
  type: z.enum(["quiz", "exam"]),
  status: z.enum(["draft"]), // Status is read-only, automatically becomes active when run is created
  start_time: z.string().min(1, "Başlanğıc tələb olunur"),
  end_time: z.string().min(1, "Bitmə tələb olunur"),
});

/** Composition rules: Quiz 12 closed + 3 open; Exam 22 closed + 5 open + 3 situation */
const QUIZ_REQUIRED = { closed: 12, open: 3, situation: 0 };
const EXAM_REQUIRED = { closed: 22, open: 5, situation: 3 };

function getRequiredCounts(type: "quiz" | "exam") {
  return type === "quiz" ? QUIZ_REQUIRED : EXAM_REQUIRED;
}

function getCountsFromDetail(examDetail: ExamDetail | null | undefined): { closed: number; open: number; situation: number } | null {
  if (!examDetail) return null;
  const st = (examDetail as { source_type?: string }).source_type;
  if (st === "PDF" || st === "JSON") {
    const qc = examDetail.question_counts;
    if (qc) return { closed: qc.closed, open: qc.open, situation: qc.situation };
    return null;
  }
  const qs = examDetail.questions ?? [];
  let closed = 0, open = 0, situation = 0;
  for (const q of qs) {
    const t = (q as { question_type?: string }).question_type;
    if (t === "MULTIPLE_CHOICE") closed++;
    else if (t?.startsWith("OPEN")) open++;
    else if (t === "SITUATION") situation++;
  }
  return { closed, open, situation };
}

function isCompositionValid(
  counts: { closed: number; open: number; situation: number } | null,
  type: "quiz" | "exam"
): boolean {
  if (!counts) return false;
  const r = getRequiredCounts(type);
  return counts.closed === r.closed && counts.open === r.open && counts.situation === r.situation;
}

type TestFormValues = z.infer<typeof testSchema>;
type ResultFormValues = z.infer<typeof resultSchema>;
type ExamFormValues = z.infer<typeof examSchema>;

export default function TestsPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabType>(
    tabParam === "archive" || tabParam === "bank" || tabParam === "active" || tabParam === "grading" ? tabParam : "bank"
  );
  useEffect(() => {
    if (tabParam === "archive" || tabParam === "bank" || tabParam === "active" || tabParam === "grading") {
      setActiveTab(tabParam);
    }
  }, [tabParam]);
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [showCreateResult, setShowCreateResult] = useState(false);
  const [showCreateExam, setShowCreateExam] = useState(false);
  const [showAddQuestions, setShowAddQuestions] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [selectedArchiveExams, setSelectedArchiveExams] = useState<Set<number>>(new Set());
  const [examTopicFilter, setExamTopicFilter] = useState("");
  const [gradingExamId, setGradingExamId] = useState<number | null>(null);
  const [gradingGroupId, setGradingGroupId] = useState<string>("");
  const [gradingStatus, setGradingStatus] = useState<string>("");
  const [selectedAttemptId, setSelectedAttemptId] = useState<number | null>(null);
  const [showGradingModal, setShowGradingModal] = useState(false);
  const [manualScores, setManualScores] = useState<Record<string, number>>({});
  const [situationScores, setSituationScores] = useState<Record<number, number | string>>({});
  const [canvasPreviewUrl, setCanvasPreviewUrl] = useState<string | null>(null);

  const SITUATION_MULTIPLIERS_SET2 = [
    { value: 0, label: "0" },
    { value: 2 / 3, label: "2/3" },
    { value: 1, label: "1" },
    { value: 4 / 3, label: "4/3" },
    { value: 2, label: "2" },
  ];
  const [showExamSettings, setShowExamSettings] = useState(false);
  const [examDuration, setExamDuration] = useState<number>(60);
  const [examStartTime, setExamStartTime] = useState<string>("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [assignMode, setAssignMode] = useState<"groups" | "student">("groups");
  const [archiveSubTab, setArchiveSubTab] = useState<ArchiveSubTab>("exams");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [showHardDeleteModal, setShowHardDeleteModal] = useState<{ type: string; id: number; name: string } | null>(null);
  const [hardDeleteStep, setHardDeleteStep] = useState<1 | 2>(1);
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState(false);
  const [hardDeleteTyped, setHardDeleteTyped] = useState("");
  const [gradingShowArchived, setGradingShowArchived] = useState(false);
  const [showCreateRunModal, setShowCreateRunModal] = useState(false);
  const [createRunGroupId, setCreateRunGroupId] = useState<number | null>(null);
  const [createRunStudentId, setCreateRunStudentId] = useState<number | null>(null);
  const [createRunStartNow, setCreateRunStartNow] = useState(true);
  const [createExamSource, setCreateExamSource] = useState<"BANK" | "JSON" | "PDF">("BANK");
  const [createExamJson, setCreateExamJson] = useState("");
  const [createExamPdfId, setCreateExamPdfId] = useState<number | null>(null);
  const [createExamJsonError, setCreateExamJsonError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const debouncedArchiveSearch = useDebounce(archiveSearch, 300);

  const { data: pdfsList = [] } = useQuery({
    queryKey: ["teacher", "pdfs"],
    queryFn: () => teacherApi.getPDFs(),
    enabled: showCreateExam && createExamSource === "PDF",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["teacher", "tests"],
    queryFn: () => teacherApi.getTests(),
  });
  const { data: exams = [], isLoading: examsLoading } = useQuery({
    queryKey: ["teacher", "exams"],
    queryFn: () => teacherApi.getExams(),
  });

  const now = new Date();
  const activeExams = (exams as ExamListItem[]).filter((ex) => ex.status === "active");
  const { data: examDetail, isLoading: examDetailLoading } = useQuery({
    queryKey: ["teacher", "exam", selectedExamId],
    queryFn: () => teacherApi.getExamDetail(selectedExamId!),
    enabled: selectedExamId != null,
  });
  const { data: topics = [] } = useQuery({
    queryKey: ["teacher", "question-topics"],
    queryFn: () => teacherApi.getQuestionTopics(),
  });
  const { data: questionsForExam = [] } = useQuery({
    queryKey: ["teacher", "questions", examTopicFilter],
    queryFn: () => teacherApi.getQuestions(examTopicFilter ? { topic: examTopicFilter } : undefined),
    enabled: showAddQuestions,
  });

  const { data: students } = useQuery({
    queryKey: ["teacher", "students", "active"],
    queryFn: () => teacherApi.getStudents("active"),
  });
  const { data: groups } = useQuery({
    queryKey: ["teacher", "groups"],
    queryFn: () => teacherApi.getGroups(),
    staleTime: 60 * 1000, // Cache groups for 1 minute
  });
  const { data: attemptsData, isLoading: attemptsLoading } = useQuery({
    queryKey: ["teacher", "exam-attempts", gradingExamId, gradingGroupId, gradingStatus, gradingShowArchived],
    queryFn: () => teacherApi.getExamAttempts(gradingExamId!, { groupId: gradingGroupId || undefined, status: gradingStatus || undefined, showArchived: gradingShowArchived }),
    enabled: gradingExamId != null && activeTab === "grading",
    refetchInterval: 10000, // Real-time polling 10s
  });
  const { data: archiveExamsData } = useQuery({
    queryKey: ["teacher", "archive", "exams", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveExams({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "exams",
  });
  const { data: archiveQuestionsData } = useQuery({
    queryKey: ["teacher", "archive", "questions", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveQuestions({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "questions",
  });
  const { data: archiveTopicsData } = useQuery({
    queryKey: ["teacher", "archive", "question-topics", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveQuestionTopics({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "topics",
  });
  const { data: archiveCodingTopicsData } = useQuery({
    queryKey: ["teacher", "archive", "coding-topics", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveCodingTopics({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "codingTopics",
  });
  const { data: archiveCodingTasksData } = useQuery({
    queryKey: ["teacher", "archive", "coding-tasks", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveCodingTasks({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "codingTasks",
  });
  const { data: archivePdfsData } = useQuery({
    queryKey: ["teacher", "archive", "pdfs", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchivePdfs({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "pdfs",
  });
  const { data: archivePaymentsData } = useQuery({
    queryKey: ["teacher", "archive", "payments", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchivePayments({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "payments",
  });
  const { data: archiveGroupsData } = useQuery({
    queryKey: ["teacher", "archive", "groups", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveGroups({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "groups",
  });
  const { data: archiveStudentsData } = useQuery({
    queryKey: ["teacher", "archive", "students", debouncedArchiveSearch],
    queryFn: () => teacherApi.getArchiveStudents({ q: debouncedArchiveSearch || undefined }),
    enabled: activeTab === "archive" && archiveSubTab === "students",
  });
  const { data: attemptDetail, isLoading: attemptDetailLoading } = useQuery({
    queryKey: ["teacher", "attempt-detail", selectedAttemptId],
    queryFn: () => teacherApi.getAttemptDetail(selectedAttemptId!),
    enabled: selectedAttemptId != null,
  });

  const examComposition = useMemo(() => {
    const d = examDetail;
    const counts = getCountsFromDetail(d);
    const required = d?.type ? getRequiredCounts(d.type) : null;
    const valid = counts && required ? isCompositionValid(counts, d!.type) : false;
    const sourceType = (d as { source_type?: string })?.source_type;
    const hasPdfAndAnswerKey = Boolean(
      (d as { pdf_url?: string })?.pdf_url
    ) && Boolean((d as { has_answer_key?: boolean })?.has_answer_key);
    const canActivate = valid && (sourceType !== "PDF" || hasPdfAndAnswerKey);
    const invalidReason = !valid
      ? "Sual tərkibi uyğun deyil (quiz: 12 qapalı + 3 açıq; imtahan: 22 qapalı + 5 açıq + 3 situasiya)."
      : sourceType === "PDF" && !hasPdfAndAnswerKey
        ? "PDF imtahanı üçün PDF faylı və cavab açarı tələb olunur."
        : null;
    return { counts, required, canActivate, invalidReason };
  }, [examDetail]);

  const createTestMutation = useMutation({
    mutationFn: (data: Partial<Test>) => teacherApi.createTest(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "tests"] });
      setShowCreateTest(false);
    },
  });

  const createResultMutation = useMutation({
    mutationFn: (data: ResultFormValues) =>
      teacherApi.createTestResult({
        studentProfileId: data.studentProfileId,
        groupId: data.groupId && data.groupId > 0 ? data.groupId : undefined,
        testName: data.testName,
        maxScore: data.maxScore,
        score: data.score,
        date: data.date,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "tests"] });
      setShowCreateResult(false);
    },
  });

  const createExamMutation = useMutation({
    mutationFn: (data: { title: string; type: "quiz" | "exam"; status: string; start_time: string; end_time: string }) =>
      teacherApi.createExam(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      setShowCreateExam(false);
    },
    onError: (error: any) => {
      console.error("Create exam error:", error);
      console.error("Error status:", error?.status);
      console.error("Error message:", error?.message);
      console.error("Error response data:", error?.response?.data || error?.data);
      console.error("Full error object:", JSON.stringify(error, null, 2));
      const errorData = error?.response?.data || error?.data;
      let errorMessage = error?.message || "İmtahan yaradıla bilmədi";
      if (errorData) {
        if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (typeof errorData === 'object' && !Array.isArray(errorData)) {
          const fieldErrors: string[] = [];
          for (const [field, errors] of Object.entries(errorData)) {
            if (Array.isArray(errors)) {
              fieldErrors.push(`${field}: ${errors.join(', ')}`);
            } else if (typeof errors === 'string') {
              fieldErrors.push(`${field}: ${errors}`);
            } else if (errors && typeof errors === 'object') {
              fieldErrors.push(`${field}: ${JSON.stringify(errors)}`);
            }
          }
          errorMessage = fieldErrors.length > 0 ? fieldErrors.join('; ') : (errorData.message || JSON.stringify(errorData));
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      }
      alert(`Xəta: ${errorMessage}`);
    },
  });
  const addExamQuestionMutation = useMutation({
    mutationFn: ({ examId, questionId }: { examId: number; questionId: number }) =>
      teacherApi.addExamQuestion(examId, questionId),
    onSuccess: (_data, { examId }) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam", examId] });
    },
  });
  const removeExamQuestionMutation = useMutation({
    mutationFn: ({ examId, questionId }: { examId: number; questionId: number }) =>
      teacherApi.removeExamQuestion(examId, questionId),
    onSuccess: () => {
      if (selectedExamId) queryClient.invalidateQueries({ queryKey: ["teacher", "exam", selectedExamId] });
    },
  });
  const gradeAttemptMutation = useMutation({
    mutationFn: ({ attemptId, publish }: { attemptId: number; publish: boolean }) => {
      const situationAnswers = (attemptDetail?.answers ?? []).filter((a) => a.questionType === "SITUATION");
      const per_situation_scores = situationAnswers.map((_, idx) => ({
        index: idx + 1,
        fraction: situationScores[idx + 1] ?? 0,
      }));
      return teacherApi.gradeAttempt(attemptId, {
        manualScores,
        per_situation_scores: per_situation_scores.length ? per_situation_scores : undefined,
        publish,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "attempt-detail"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
      setShowGradingModal(false);
      setManualScores({});
      setSituationScores({});
      setSelectedAttemptId(null);
    },
  });
  const publishAttemptMutation = useMutation({
    mutationFn: ({ attemptId, publish }: { attemptId: number; publish: boolean }) =>
      teacherApi.publishAttempt(attemptId, publish),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
    },
  });
  const createRunMutation = useMutation({
    mutationFn: (examId: number) => {
      const payload = {
        duration_minutes: examDuration,
        start_now: createRunStartNow,
        groupId: createRunGroupId ?? undefined,
        studentId: createRunStudentId ?? undefined,
      };
      return teacherApi.createExamRun(examId, payload);
    },
    onSuccess: (_, examId) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam", examId] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      setShowCreateRunModal(false);
      setCreateRunGroupId(null);
      setCreateRunStudentId(null);
    },
  });
  const startExamMutation = useMutation({
    mutationFn: (examId: number) => {
      const payload: { groupIds?: number[]; studentId?: number; durationMinutes: number; startTime?: string } = {
        durationMinutes: examDuration,
      };
      if (examStartTime) {
        // Convert datetime-local to ISO string
        payload.startTime = new Date(examStartTime).toISOString();
      }
      if (assignMode === "groups" && selectedGroupIds.length > 0) {
        payload.groupIds = selectedGroupIds;
      } else if (assignMode === "student" && selectedStudentId) {
        payload.studentId = selectedStudentId;
      } else {
        throw new Error("Qrup və ya şagird seçin");
      }
      return teacherApi.startExamNow(examId, payload);
    },
    onSuccess: (_, examId) => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam", examId] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      setShowExamSettings(false);
      setSelectedGroupIds([]);
      setSelectedStudentId(null);
    },
  });
  const stopExamMutation = useMutation({
    mutationFn: (examId: number) => teacherApi.stopExam(examId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
    },
  });
  const bulkDeleteExamsMutation = useMutation({
    mutationFn: (ids: number[]) => teacherApi.bulkDeleteExams(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "archive"] });
      setSelectedArchiveExams(new Set());
    },
  });
  const hardDeleteMutation = useMutation({
    mutationFn: async ({ type, id, force }: { type: string; id: number; force?: boolean }) => {
      if (type === "exam") return teacherApi.hardDeleteExam(id, force);
      if (type === "question") return teacherApi.hardDeleteQuestion(id);
      if (type === "topic") return teacherApi.hardDeleteQuestionTopic(id);
      if (type === "pdf") return teacherApi.hardDeletePdf(id);
      if (type === "codingTopic") return teacherApi.hardDeleteCodingTopic(id);
      if (type === "codingTask") return teacherApi.hardDeleteCodingTask(id);
      throw new Error("Unknown type");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher"] });
      setShowHardDeleteModal(null);
      setHardDeleteStep(1);
      setHardDeleteConfirm(false);
      setHardDeleteTyped("");
    },
    onError: (err: any) => {
      if (err?.response?.status === 409 && err?.response?.data?.code === "HAS_ATTEMPTS") {
        alert("İmtahanda cəhdlər var. Tam silmək mümkün deyil.");
      }
    },
  });
  const restartAttemptMutation = useMutation({
    mutationFn: ({ attemptId, duration }: { attemptId: number; duration?: number }) =>
      teacherApi.restartAttempt(attemptId, duration ?? 60),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher", "exam-attempts"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "exam-results"] });
    },
  });

  const {
    register: registerTest,
    handleSubmit: handleSubmitTest,
    formState: { errors: errorsTest },
    reset: resetTest,
  } = useForm<TestFormValues>({
    resolver: zodResolver(testSchema),
    defaultValues: { type: "quiz" },
  });

  const {
    register: registerResult,
    handleSubmit: handleSubmitResult,
    formState: { errors: errorsResult },
    reset: resetResult,
  } = useForm<ResultFormValues>({
    resolver: zodResolver(resultSchema),
  });

  const {
    register: registerExam,
    handleSubmit: handleSubmitExam,
    formState: { errors: errorsExam },
    reset: resetExam,
  } = useForm<ExamFormValues>({
    resolver: zodResolver(examSchema),
    defaultValues: { type: "exam", status: "draft" },
  });

  const [addQuestionIds, setAddQuestionIds] = useState<number[]>([]);
  const examQuestionIds = new Set((examDetail?.questions ?? []).map((q) => q.question));

  if (isLoading) return <Loading />;

  const tests: Test[] = data?.tests || [];
  const results: TestResult[] = data?.results || [];

  return (
    <div className="page-container">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Testlər</h1>
        {activeTab === "bank" && (
          <button
            onClick={() => {
              setShowCreateExam(true);
              resetExam({
                type: "exam",
                status: "draft",
                title: "",
                start_time: "",
                end_time: "",
              });
            }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Yeni imtahan
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("bank")}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "bank"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Test bankı
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "active"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Aktiv testlər
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("grading")}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "grading"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Nəticələr / Yoxlama
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("archive")}
            className={`pb-3 px-1 font-medium transition-colors ${
              activeTab === "archive"
                ? "text-primary-600 border-b-2 border-primary-600"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Arxiv
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "bank" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">İmtahanlar</h2>
            {examsLoading ? (
              <p className="text-slate-500 py-4">Yüklənir...</p>
            ) : (exams as ExamListItem[]).length > 0 ? (
              <ul className="space-y-2">
                {(exams as ExamListItem[]).map((ex) => (
                  <li
                    key={ex.id}
                    className={`flex items-center justify-between py-2 px-2 rounded border cursor-pointer ${
                      selectedExamId === ex.id ? "border-primary-500 bg-primary-50" : "border-slate-100"
                    }`}
                    onClick={() => setSelectedExamId(ex.id)}
                  >
                    <span className="font-medium text-slate-900">{ex.title}</span>
                    <span className="text-xs text-slate-500">
                      {ex.type === "quiz" ? "Quiz" : "İmtahan"} · {ex.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 py-4">İmtahan tapılmadı</p>
            )}
          </div>
          <div className="card">
            {selectedExamId == null ? (
              <p className="text-slate-500 py-4">İmtahan seçin</p>
            ) : examDetailLoading ? (
              <p className="text-slate-500 py-4">Yüklənir...</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900">{examDetail?.title}</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-outline text-sm"
                      onClick={() => {
                        setAddQuestionIds([]);
                        setExamTopicFilter("");
                        setShowAddQuestions(true);
                      }}
                    >
                      Sual əlavə et
                    </button>
                    <button
                      type="button"
                      className="btn-outline text-sm text-amber-700 border-amber-200 hover:bg-amber-50 flex items-center gap-1"
                      onClick={() => {
                        if (confirm("İmtahanı arxivə göndərmək istədiyinizə əminsiniz?")) {
                          teacherApi.deleteExam(selectedExamId!).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["teacher"] });
                            setSelectedExamId(null);
                          });
                        }
                      }}
                    >
                      <Archive className="w-4 h-4" />
                      Arxivə göndər
                    </button>
                  </div>
                </div>
                
                {/* Exam Status & Metadata */}
                <div className="mb-4 space-y-2 border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <span className="text-xs text-slate-500">Status:</span>
                      <span className="text-sm font-medium ml-2">
                        {examDetail?.status === "draft" ? "Qaralama" : 
                         examDetail?.status === "active" ? "Aktiv" : 
                         examDetail?.status === "finished" ? "Bitmiş" : 
                         examDetail?.is_archived ? "Arxiv" : "Qaralama"}
                      </span>
                    </div>
                    {examDetail?.duration_minutes && (
                      <div>
                        <span className="text-xs text-slate-500">Müddət:</span>
                        <span className="text-sm font-medium ml-2">{examDetail.duration_minutes} dəq</span>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-slate-600">
                    <div>
                      <span className="text-xs text-slate-500">Başlanğıc:</span>{" "}
                      {examDetail?.start_time ? new Date(examDetail.start_time).toLocaleString("az-AZ") : "-"}
                    </div>
                    <div>
                      <span className="text-xs text-slate-500">Bitmə:</span>{" "}
                      {examDetail?.end_time ? new Date(examDetail.end_time).toLocaleString("az-AZ") : "-"}
                    </div>
                  </div>
                  {examDetail?.assigned_groups && examDetail.assigned_groups.length > 0 && (
                    <div>
                      <span className="text-xs text-slate-500">Qruplar:</span>{" "}
                      <span className="text-sm">{examDetail.assigned_groups.map((g: any) => g.name).join(", ")}</span>
                    </div>
                  )}
                  <>
                        {(examDetail as any)?.source_type && (
                          <p className="text-xs text-slate-500 mt-1">
                            Mənbə: {(examDetail as any).source_type === "BANK" ? "Hazır suallar" : (examDetail as any).source_type === "PDF" ? "PDF + Cavab açarı" : "JSON"}
                          </p>
                        )}
                        {examComposition.counts && examComposition.required && (
                          <div className="space-y-1 mt-1">
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              <span className={examComposition.counts.closed === examComposition.required.closed ? "text-green-600 font-medium" : "text-orange-600"}>
                                Qapalı: {examComposition.counts.closed} / {examComposition.required.closed}
                              </span>
                              <span className={examComposition.counts.open === examComposition.required.open ? "text-green-600 font-medium" : "text-orange-600"}>
                                Açıq: {examComposition.counts.open} / {examComposition.required.open}
                              </span>
                              <span className={examComposition.counts.situation === examComposition.required.situation ? "text-green-600 font-medium" : "text-orange-600"}>
                                Situasiya: {examComposition.counts.situation} / {examComposition.required.situation}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                          <button
                            type="button"
                            className="btn-outline text-sm"
                            disabled={!examComposition.canActivate}
                            onClick={() => {
                              if (examDetail?.assigned_groups) {
                                setSelectedGroupIds(examDetail.assigned_groups.map((g: any) => g.id));
                              }
                              setExamDuration(examDetail?.duration_minutes || 60);
                              // Set default start time to now (formatted for datetime-local)
                              const now = new Date();
                              now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                              setExamStartTime(now.toISOString().slice(0, 16));
                              setShowExamSettings(true);
                            }}
                          >
                            Qruplar təyin et / Başlat
                          </button>
                          {!examComposition.canActivate && examComposition.invalidReason && (
                            <span className="text-xs text-orange-600 max-w-xs">{examComposition.invalidReason}</span>
                          )}
                        </div>
                      </>
                  {(examDetail as any)?.runs != null && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">Başlamalar</h4>
                      <ul className="space-y-2 mb-2">
                        {(examDetail as any).runs.slice(0, 5).map((r: any) => (
                          <li key={r.id} className="text-sm flex items-center justify-between">
                            <span>
                              {r.group_name || r.student_name || "—"} • 
                              Başlanğıc: {r.start_at ? new Date(r.start_at).toLocaleString("az-AZ") : "-"} • 
                              Müddət: {r.duration_minutes || "-"} dəq • 
                              {r.attempt_count ?? 0} cəhd
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-blue-600 hover:underline text-xs"
                                onClick={() => { setGradingExamId(selectedExamId ?? null); setActiveTab("grading"); }}
                              >
                                Nəticələr
                              </button>
                              {r.status === "active" && (
                                <>
                                  <button
                                    type="button"
                                    className="text-orange-600 hover:underline text-xs"
                                    onClick={() => {
                                      const newDuration = prompt(`Yeni müddət (dəqiqə):`, r.duration_minutes);
                                      if (newDuration && selectedExamId) {
                                        teacherApi.updateRun(r.id, { duration_minutes: parseInt(newDuration, 10) }).then(() => {
                                          queryClient.invalidateQueries({ queryKey: ["teacher", "exam", selectedExamId] });
                                        });
                                      }
                                    }}
                                  >
                                    Müddəti dəyiş
                                  </button>
                                </>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-outline text-sm"
                          onClick={() => { setExamDuration(examDetail?.duration_minutes || 60); setShowCreateRunModal(true); }}
                        >
                          Yeni başlama yarat
                        </button>
                        {examDetail?.status === "active" && (
                          <button
                            type="button"
                            className="btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => {
                              if (confirm("İmtahanı dayandırmaq istədiyinizə əminsiniz?")) {
                                teacherApi.stopExam(selectedExamId!).then(() => {
                                  queryClient.invalidateQueries({ queryKey: ["teacher", "exam", selectedExamId] });
                                  queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
                                });
                              }
                            }}
                          >
                            Dayandır
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {((examDetail as { source_type?: string })?.source_type === "PDF" || (examDetail as { source_type?: string })?.source_type === "JSON") && (
                  <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4 border-b border-slate-200 pb-6">
                    <div className="lg:col-span-2">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">PDF baxış</h4>
                      {(examDetail as { pdf_url?: string })?.pdf_url ? (() => {
                        const pdfUrl = (examDetail as { pdf_url?: string }).pdf_url!;
                        const embeddedUrl = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}embedded=true`;
                        return (
                          <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                            <iframe
                              title="İmtahan PDF"
                              src={embeddedUrl}
                              className="w-full min-h-[400px] max-h-[60vh]"
                            />
                          </div>
                        );
                      })() : (
                        <p className="text-sm text-slate-500 py-4">PDF yüklənməyib və ya mövcud deyil.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-slate-700 mb-2">Cavab vərəqi</h4>
                      {(examDetail as ExamDetail).answer_key_preview && (examDetail as ExamDetail).answer_key_preview!.length > 0 ? (
                        <ul className="space-y-1.5 text-xs border border-slate-200 rounded-lg p-3 bg-slate-50 max-h-[60vh] overflow-y-auto">
                          {((examDetail as ExamDetail).answer_key_preview!).map((q, idx) => (
                            <li key={idx} className="flex justify-between gap-2 py-1 border-b border-slate-100 last:border-0">
                              <span className="font-medium text-slate-800">#{q.number ?? idx + 1}</span>
                              <span className="text-slate-600">{q.kind === "mc" ? "Qapalı" : q.kind === "open" ? "Açıq" : "Situasiya"}</span>
                              <span className="text-green-700 font-medium truncate max-w-[80px]" title={String(q.correct ?? q.open_answer ?? "")}>{q.correct ?? q.open_answer ?? "—"}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500 py-2">Cavab açarı siyahısı mövcud deyil.</p>
                      )}
                    </div>
                  </div>
                )}

                {examDetail?.questions && examDetail.questions.length > 0 ? (
                  <ul className="space-y-2">
                    {examDetail.questions.map((eq) => (
                      <li
                        key={eq.id}
                        className="flex items-center justify-between py-2 border-b border-slate-100"
                      >
                        <span className="text-sm text-slate-800 truncate flex-1">{eq.question_text}</span>
                        <button
                          type="button"
                          className="text-red-600 hover:bg-red-50 p-1 rounded"
                          onClick={() =>
                            removeExamQuestionMutation.mutate({ examId: selectedExamId, questionId: eq.question })
                          }
                          disabled={removeExamQuestionMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500 py-4">Bu imtahanda hələ sual yoxdur. &quot;Sual əlavə et&quot; ilə əlavə edin.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "active" && (
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Aktiv testlər</h2>
          {examsLoading ? (
            <p className="text-slate-500 py-4">Yüklənir...</p>
          ) : activeExams.length > 0 ? (
            <div className="space-y-4">
              {activeExams.map((ex) => {
                const end = new Date(ex.end_time);
                const remaining = Math.max(0, Math.floor((end.getTime() - now.getTime()) / (1000 * 60)));
                const isGhost = !!ex.is_ghost;
                return (
                  <div key={ex.id} className={`border rounded-lg p-4 ${isGhost ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}>
                    {isGhost && (
                      <p className="text-sm text-amber-700 mb-2 flex items-center gap-1">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        Müddət və ya təyinat olmadığı üçün idarə olunmur. Müəllim sahədən qrup təyin edib &quot;İndi başlat&quot; edin.
                      </p>
                    )}
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-slate-900">{ex.title}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {remaining > 0 ? `${remaining} dəq qalıb` : "Bitmiş"}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { setActiveTab("grading"); setGradingExamId(ex.id); }}
                            className="btn-outline text-sm flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            Nəticələr
                          </button>
                          {!isGhost && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm("İmtahanı dayandırmaq istədiyinizə əminsiniz?")) {
                                  stopExamMutation.mutate(ex.id);
                                }
                              }}
                              disabled={stopExamMutation.isPending}
                              className="btn-outline text-sm flex items-center gap-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                            >
                              <StopCircle className="w-4 h-4" />
                              Dayandır
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600">
                      {new Date(ex.start_time).toLocaleString("az-AZ")} – {new Date(ex.end_time).toLocaleString("az-AZ")}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 py-4">Hazırda aktiv test yoxdur</p>
          )}
        </div>
      )}

      {activeTab === "grading" && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">İmtahan</label>
                <select
                  className="input w-full"
                  value={gradingExamId || ""}
                  onChange={(e) => setGradingExamId(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">Hamısı</option>
                  {(exams as ExamListItem[]).map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Qrup</label>
                <select
                  className="input w-full"
                  value={gradingGroupId}
                  onChange={(e) => setGradingGroupId(e.target.value)}
                >
                  <option value="">Hamısı</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  className="input w-full"
                  value={gradingStatus}
                  onChange={(e) => setGradingStatus(e.target.value)}
                >
                  <option value="">Hamısı</option>
                  <option value="submitted">Təqdim edilmiş</option>
                  <option value="waiting_manual">Manual gözləyir</option>
                  <option value="graded">Qiymətləndirilmiş</option>
                  <option value="published">Yayımlanmış</option>
                </select>
              </div>
            </div>
          </div>

          {/* Attempts List */}
          <div className="card overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                Göndərişlər
                {(attemptsData?.attempts?.some((a: ExamAttempt) => a.status === "SUBMITTED") || attemptsData?.runs?.some((r: any) => r.attempts?.some((a: ExamAttempt) => a.status === "SUBMITTED"))) && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full animate-pulse">Yeni submit</span>
                )}
              </h2>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={gradingShowArchived}
                  onChange={(e) => setGradingShowArchived(e.target.checked)}
                />
                Köhnə attempt-lər
              </label>
            </div>
            {attemptsLoading ? (
              <p className="text-slate-500 py-4">Yüklənir...</p>
            ) : !gradingExamId ? (
              <p className="text-slate-500 py-4">İmtahan seçin</p>
            ) : (attemptsData?.runs && attemptsData.runs.length > 0) || (attemptsData?.attempts && attemptsData.attempts.length > 0) ? (
              attemptsData.runs ? (
                // Group exam: show runs as expandable blocks
                <div className="space-y-4">
                  {attemptsData.runs.map((run: any) => (
                    <div key={run.runId} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 p-4 flex items-center justify-between cursor-pointer hover:bg-slate-100" onClick={() => {
                        const expanded = (document.getElementById(`run-${run.runId}`) as HTMLDivElement)?.style.display !== 'none';
                        const el = document.getElementById(`run-${run.runId}`);
                        if (el) el.style.display = expanded ? 'none' : 'block';
                      }}>
                        <div className="flex-1">
                          <h3 className="font-semibold text-slate-900">{run.examTitle}</h3>
                          <div className="text-sm text-slate-600 mt-1">
                            {run.groupName ? `Qrup: ${run.groupName}` : run.studentName ? `Şagird: ${run.studentName}` : ""}
                            {" · "}
                            Başlanğıc: {new Date(run.startAt).toLocaleString("az-AZ")}
                            {" · "}
                            Müddət: {run.durationMinutes} dəq
                            {" · "}
                            {run.attemptCount} nəfər başladı
                          </div>
                        </div>
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      </div>
                      <div id={`run-${run.runId}`} className="hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Şagird</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Status</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Avto</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Manual</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Cəmi</th>
                              <th className="text-left py-2 px-4 text-sm font-semibold text-slate-700">Əməliyyat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {run.attempts.map((a: ExamAttempt) => (
                              <tr
                                key={a.id || a.studentId}
                                className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                                onClick={() => {
                                  if (a.id) {
                                    setSelectedAttemptId(a.id);
                                    setShowGradingModal(true);
                                  }
                                }}
                              >
                                <td className="py-2 px-4 text-sm text-slate-900">{a.studentName}</td>
                                <td className="py-2 px-4 text-sm">
                                  <span
                                    className={
                                      a.status === "SUBMITTED"
                                        ? "text-green-600"
                                        : a.status === "EXPIRED"
                                          ? "text-amber-600"
                                          : a.status === "NOT_STARTED"
                                            ? "text-slate-400"
                                            : "text-blue-600"
                                    }
                                  >
                                    {a.status === "SUBMITTED" ? "Təqdim" : a.status === "EXPIRED" ? "Vaxt bitdi" : a.status === "NOT_STARTED" ? "Başlamayıb" : "Davam edir"}
                                  </span>
                                </td>
                                <td className="py-2 px-4 text-sm">{a.autoScore != null ? Number(a.autoScore).toFixed(1) : "-"}</td>
                                <td className="py-2 px-4 text-sm">
                                  {a.manualPendingCount > 0 && (
                                    <span className="text-orange-600 font-medium">{a.manualPendingCount} gözləyir</span>
                                  )}
                                  {a.manualScore != null && <span>{Number(a.manualScore).toFixed(1)}</span>}
                                </td>
                                <td className="py-2 px-4 text-sm font-medium">
                                  {a.finalScore != null ? Number(a.finalScore).toFixed(1) : "-"} / {a.maxScore ?? "-"}
                                </td>
                                <td className="py-2 px-4 text-sm" onClick={(e) => e.stopPropagation()}>
                                  {a.id ? (
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedAttemptId(a.id!);
                                          setShowGradingModal(true);
                                        }}
                                        className="text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        <Eye className="w-4 h-4" />
                                        Bax
                                      </button>
                                      {(a.status === "EXPIRED" || a.status === "IN_PROGRESS") && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            restartAttemptMutation.mutate({ attemptId: a.id!, duration: 60 })
                                          }
                                          disabled={restartAttemptMutation.isPending}
                                          className="text-amber-600 hover:underline flex items-center gap-1 text-xs"
                                          title="Şagird üçün yenidən başlat"
                                        >
                                          <RotateCcw className="w-3 h-3" />
                                          Yenidən başlat
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 text-xs">Başlamayıb</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // Individual student exam: show flat list
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Şagird</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Qrup</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Cəhd</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Təqdim</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Avto</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Manual</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Cəmi</th>
                      <th className="text-left py-2 text-sm font-semibold text-slate-700">Əməliyyat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attemptsData.attempts.map((a: ExamAttempt) => (
                      <tr
                        key={a.id}
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                        onClick={() => {
                          setSelectedAttemptId(a.id);
                          setShowGradingModal(true);
                        }}
                      >
                        <td className="py-2 text-sm text-slate-900">{a.studentName}</td>
                        <td className="py-2 text-sm text-slate-600">{a.groupName || "-"}</td>
                        <td className="py-2 text-sm">
                          <span
                            className={
                              a.status === "SUBMITTED"
                                ? "text-green-600"
                                : a.status === "EXPIRED"
                                  ? "text-amber-600"
                                  : "text-blue-600"
                            }
                          >
                            {a.status === "SUBMITTED" ? "Təqdim" : a.status === "EXPIRED" ? "Vaxt bitdi" : "Davam edir"}
                          </span>
                        </td>
                        <td className="py-2 text-sm text-slate-600">
                          {(a.submittedAt ?? a.finishedAt) ? new Date(a.submittedAt ?? a.finishedAt!).toLocaleString("az-AZ") : "-"}
                        </td>
                        <td className="py-2 text-sm">{a.autoScore != null ? Number(a.autoScore).toFixed(1) : "-"}</td>
                        <td className="py-2 text-sm">
                          {a.manualPendingCount > 0 && (
                            <span className="text-orange-600 font-medium">{a.manualPendingCount} gözləyir</span>
                          )}
                          {a.manualScore != null && <span>{Number(a.manualScore).toFixed(1)}</span>}
                        </td>
                        <td className="py-2 text-sm font-medium">
                          {a.finalScore != null ? Number(a.finalScore).toFixed(1) : "-"} / {a.maxScore ?? "-"}
                        </td>
                        <td className="py-2 text-sm" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAttemptId(a.id);
                                setShowGradingModal(true);
                              }}
                              className="text-blue-600 hover:underline flex items-center gap-1"
                            >
                              <Eye className="w-4 h-4" />
                              Bax
                            </button>
                            {(a.status === "EXPIRED" || a.status === "IN_PROGRESS") && (
                              <button
                                type="button"
                                onClick={() =>
                                  restartAttemptMutation.mutate({ attemptId: a.id, duration: 60 })
                                }
                                disabled={restartAttemptMutation.isPending}
                                className="text-amber-600 hover:underline flex items-center gap-1 text-xs"
                                title="Şagird üçün yenidən başlat"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Yenidən başlat
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              <p className="text-slate-500 py-4">Göndəriş tapılmadı</p>
            )}
          </div>

          {/* Legacy Results */}
          <div className="card overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Köhnə Qiymət Nəticələri</h2>
              <button
                onClick={() => {
                  setShowCreateResult(true);
                  resetResult();
                }}
                className="btn-outline text-sm"
              >
                Qiymət Əlavə Et
              </button>
            </div>
            {results.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 text-sm font-semibold text-slate-700">Test</th>
                    <th className="text-left py-2 text-sm font-semibold text-slate-700">Xal</th>
                    <th className="text-left py-2 text-sm font-semibold text-slate-700">Tarix</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-2 text-sm text-slate-900">{r.testName}</td>
                      <td className="py-2 text-sm">
                        {r.score} / {r.maxScore}
                      </td>
                      <td className="py-2 text-sm text-slate-600">
                        {new Date(r.date).toLocaleDateString("az-AZ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-slate-500 py-4">Nəticə tapılmadı</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "archive" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {(["exams", "questions", "topics", "pdfs", "codingTopics", "codingTasks", "payments", "groups", "students"] as ArchiveSubTab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setArchiveSubTab(t)}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  archiveSubTab === t ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {t === "exams" ? "İmtahanlar" : t === "questions" ? "Suallar" : t === "topics" ? "Sual mövzuları" : t === "pdfs" ? "PDFs" : t === "codingTopics" ? "Kod mövzuları" : t === "codingTasks" ? "Kod tapşırıqları" : t === "payments" ? "Ödənişlər" : t === "groups" ? "Qruplar" : "Şagirdlər"}
              </button>
            ))}
          </div>
          <div className="mb-4">
            <input
              type="text"
              className="input w-full max-w-md"
              placeholder="Axtar…"
              value={archiveSearch}
              onChange={(e) => setArchiveSearch(e.target.value)}
            />
          </div>
          <div className="card">
            {archiveSubTab === "exams" && archiveExamsData?.items && archiveExamsData.items.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={archiveExamsData.items.every((ex: ExamListItem) => selectedArchiveExams.has(ex.id)) && archiveExamsData.items.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedArchiveExams(new Set(archiveExamsData.items.map((ex: ExamListItem) => ex.id)));
                        } else {
                          setSelectedArchiveExams(new Set());
                        }
                      }}
                    />
                    Hamısını seç
                  </label>
                  {selectedArchiveExams.size > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`${selectedArchiveExams.size} seçilmiş imtahan silinsin?`)) {
                          bulkDeleteExamsMutation.mutate(Array.from(selectedArchiveExams));
                        }
                      }}
                      className="btn-outline text-sm text-red-600 border-red-200 hover:bg-red-50"
                    >
                      {selectedArchiveExams.size} seçilmiş silinsin
                    </button>
                  )}
                </div>
                <ul className="space-y-2">
                  {archiveExamsData.items.map((ex: ExamListItem & { attemptCount?: number }) => (
                    <li key={ex.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                      <input
                        type="checkbox"
                        checked={selectedArchiveExams.has(ex.id)}
                        onChange={(e) => {
                          const newSet = new Set(selectedArchiveExams);
                          if (e.target.checked) {
                            newSet.add(ex.id);
                          } else {
                            newSet.delete(ex.id);
                          }
                          setSelectedArchiveExams(newSet);
                        }}
                        className="cursor-pointer"
                      />
                      <span className="flex-1 font-medium text-slate-900">{ex.title} {ex.type === "quiz" ? "(Quiz)" : "(İmtahan)"} · {(ex as any).attemptCount ?? 0} cəhd</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => teacherApi.restoreExam(typeof ex.id === "number" ? ex.id : Number(ex.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Bərpa et</button>
                        <button type="button" onClick={() => setShowHardDeleteModal({ type: "exam", id: ex.id, name: ex.title })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {archiveSubTab === "questions" && archiveQuestionsData?.items && archiveQuestionsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveQuestionsData.items.map((q: any) => (
                  <li key={q.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="line-clamp-1 text-slate-900">{q.text}</span>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => teacherApi.restoreQuestion(typeof q.id === "number" ? q.id : Number(q.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm">Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "question", id: q.id, name: q.text?.slice(0, 50) || `Sual ${q.id}` })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "topics" && archiveTopicsData?.items && archiveTopicsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveTopicsData.items.map((t: any) => (
                  <li key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{t.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restoreQuestionTopic(typeof t.id === "number" ? t.id : Number(t.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm">Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "topic", id: t.id, name: t.name })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "pdfs" && archivePdfsData?.items && archivePdfsData.items.length > 0 && (
              <ul className="space-y-2">
                {archivePdfsData.items.map((p: any) => (
                  <li key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{p.title}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restorePdf(typeof p.id === "number" ? p.id : Number(p.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm">Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "pdf", id: p.id, name: p.title })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "codingTopics" && archiveCodingTopicsData?.items && archiveCodingTopicsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveCodingTopicsData.items.map((t: { id: number; name: string }) => (
                  <li key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{t.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restoreCodingTopic(t.id).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Bərpa et</button>
                      <button type="button" onClick={() => setShowHardDeleteModal({ type: "codingTopic", id: t.id, name: t.name })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "codingTasks" && archiveCodingTasksData?.items && archiveCodingTasksData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveCodingTasksData.items.map((t) => {
                  const tid = typeof t.id === "string" ? parseInt(t.id, 10) : t.id;
                  return (
                    <li key={tid} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <span className="font-medium text-slate-900">{t.title}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => teacherApi.restoreCodingTask(tid).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Bərpa et</button>
                        <button type="button" onClick={() => setShowHardDeleteModal({ type: "codingTask", id: tid, name: t.title })} className="text-red-600 hover:underline text-sm">Tam sil</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {archiveSubTab === "payments" && archivePaymentsData?.items && archivePaymentsData.items.length > 0 && (() => {
              const items = archivePaymentsData.items;
              const ordMap: Record<string, string> = {};
              const suf: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu", 0: "cu" };
              // Use sequenceNumber from database if available, otherwise group by student and order by date
              items.forEach((p: Payment) => {
                if (p.sequenceNumber) {
                  ordMap[p.id] = `${p.sequenceNumber}-${suf[p.sequenceNumber % 10] ?? "ci"} ödəniş`;
                } else {
                  // Fallback: group by student and order by date
                  const bySt = new Map<number, { id: string; date: string }[]>();
                  items.forEach((item) => {
                    const sid = typeof item.studentId === "number" ? item.studentId : Number(item.studentId);
                    if (!isNaN(sid) && !bySt.has(sid)) bySt.set(sid, []);
                    if (!isNaN(sid)) bySt.get(sid)!.push({ id: item.id, date: item.date });
                  });
                  bySt.forEach((list) => {
                    list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                    list.forEach((item, i) => { 
                      if (!ordMap[item.id]) {
                        const n = i + 1;
                        ordMap[item.id] = `${n}-${suf[n % 10] ?? "ci"} ödəniş`;
                      }
                    });
                  });
                }
              });
              return (
              <ul className="space-y-2">
                {items.map((p: Payment) => (
                  <li key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{p.studentName} — {ordMap[p.id] ?? ""} · {formatPaymentDisplay(p.amount, "teacher")} AZN · {p.date}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restorePayment(Number(p.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Bərpa et</button>
                    </div>
                  </li>
                ))}
              </ul>
            );})()}
            {archiveSubTab === "groups" && archiveGroupsData?.items && archiveGroupsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveGroupsData.items.map((g: any) => (
                  <li key={g.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{g.name}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restoreGroup(typeof g.id === "number" ? g.id : Number(g.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Bərpa et</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {archiveSubTab === "students" && archiveStudentsData?.items && archiveStudentsData.items.length > 0 && (
              <ul className="space-y-2">
                {archiveStudentsData.items.map((s: any) => (
                  <li key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-medium text-slate-900">{s.fullName}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => teacherApi.restoreStudent(String(s.userId ?? s.id)).then(() => queryClient.invalidateQueries({ queryKey: ["teacher"] }))} className="text-blue-600 hover:underline text-sm flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Bərpa et</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {((archiveSubTab === "exams" && (!archiveExamsData?.items || archiveExamsData.items.length === 0)) ||
              (archiveSubTab === "questions" && (!archiveQuestionsData?.items || archiveQuestionsData.items.length === 0)) ||
              (archiveSubTab === "topics" && (!archiveTopicsData?.items || archiveTopicsData.items.length === 0)) ||
              (archiveSubTab === "pdfs" && (!archivePdfsData?.items || archivePdfsData.items.length === 0)) ||
              (archiveSubTab === "codingTopics" && (!archiveCodingTopicsData?.items || archiveCodingTopicsData.items.length === 0)) ||
              (archiveSubTab === "codingTasks" && (!archiveCodingTasksData?.items || archiveCodingTasksData.items.length === 0)) ||
              (archiveSubTab === "payments" && (!archivePaymentsData?.items || archivePaymentsData.items.length === 0)) ||
              (archiveSubTab === "groups" && (!archiveGroupsData?.items || archiveGroupsData.items.length === 0)) ||
              (archiveSubTab === "students" && (!archiveStudentsData?.items || archiveStudentsData.items.length === 0))) && (
              <p className="text-slate-500 py-8 text-center">Arxivdə element tapılmadı</p>
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={showCreateTest}
        onClose={() => setShowCreateTest(false)}
        title="Yeni Test"
      >
        <form onSubmit={handleSubmitTest((v) => createTestMutation.mutate(v))} className="space-y-4">
          <div>
            <label className="label">Tip</label>
            <select className="input" {...registerTest("type")}>
              <option value="quiz">Quiz</option>
              <option value="exam">İmtahan</option>
            </select>
          </div>
          <div>
            <label className="label">Başlıq *</label>
            <input className="input" {...registerTest("title")} />
            {errorsTest.title && (
              <p className="mt-1 text-xs text-red-600">{errorsTest.title.message}</p>
            )}
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-primary flex-1" disabled={createTestMutation.isPending}>
              Yadda Saxla
            </button>
            <button type="button" onClick={() => setShowCreateTest(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showCreateExam}
        onClose={() => {
          setShowCreateExam(false);
          setCreateExamSource("BANK");
          setCreateExamJson("");
          setCreateExamPdfId(null);
          setCreateExamJsonError(null);
        }}
        title="Yeni imtahan"
        size={createExamSource !== "BANK" ? "lg" : undefined}
      >
        <form
          onSubmit={handleSubmitExam((v) => {
            setCreateExamJsonError(null);
            // Validate required datetime fields
            if (!v.start_time || !v.end_time) {
              alert("Başlanğıc və bitmə tarixi tələb olunur");
              return;
            }
            // Convert datetime-local format (YYYY-MM-DDTHH:mm) to ISO datetime string
            const startTime = new Date(v.start_time).toISOString();
            const endTime = new Date(v.end_time).toISOString();
            const payload: Parameters<typeof teacherApi.createExam>[0] = {
              title: v.title,
              type: v.type,
              status: v.status || "draft",
              start_time: startTime,
              end_time: endTime,
            };
            console.log("Creating exam with payload:", payload);
            if (createExamSource === "BANK") {
              payload.source_type = "BANK";
            } else if (createExamSource === "JSON") {
              let ak: Record<string, unknown>;
              try {
                ak = JSON.parse(createExamJson) as Record<string, unknown>;
              } catch {
                setCreateExamJsonError("JSON formatı səhvdir");
                return;
              }
              payload.source_type = "JSON";
              payload.answer_key_json = ak;
              payload.type = (ak.type as "quiz" | "exam") || v.type;
            } else {
              let ak: Record<string, unknown>;
              try {
                ak = JSON.parse(createExamJson) as Record<string, unknown>;
              } catch {
                setCreateExamJsonError("Cavab vərəqi JSON formatı səhvdir");
                return;
              }
              if (!createExamPdfId) {
                setCreateExamJsonError("PDF seçin");
                return;
              }
              payload.source_type = "PDF";
              payload.answer_key_json = ak;
              payload.pdf_id = createExamPdfId;
              payload.type = (ak.type as "quiz" | "exam") || v.type;
            }
            createExamMutation.mutate(payload);
          })}
          className="space-y-4"
        >
          <div>
            <label className="label">Mənbə</label>
            <select
              className="input"
              value={createExamSource}
              onChange={(e) => setCreateExamSource(e.target.value as "BANK" | "JSON" | "PDF")}
            >
              <option value="BANK">Sual bankı</option>
              <option value="JSON">JSON</option>
              <option value="PDF">PDF + Cavab vərəqi</option>
            </select>
          </div>
          <div>
            <label className="label">Başlıq *</label>
            <input className="input" {...registerExam("title")} />
            {errorsExam.title && (
              <p className="mt-1 text-xs text-red-600">{errorsExam.title.message}</p>
            )}
          </div>
          {createExamSource === "BANK" && (
            <>
              <div>
                <label className="label">Tip</label>
                <select className="input" {...registerExam("type")}>
                  <option value="quiz">Quiz</option>
                  <option value="exam">İmtahan</option>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" {...registerExam("status")}>
                  <option value="draft">Qaralama</option>
                  <option value="active">Aktiv</option>
                </select>
              </div>
            </>
          )}
          {createExamSource === "PDF" && (
            <div>
              <label className="label">PDF</label>
              <select
                className="input"
                value={createExamPdfId ?? ""}
                onChange={(e) => setCreateExamPdfId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Seçin</option>
                {(pdfsList as { id: number; title: string }[]).map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Əvvəlcə PDF kitabxanasına yükləyin (PDFs sekmesi)</p>
            </div>
          )}
          {(createExamSource === "JSON" || createExamSource === "PDF") && (
            <div>
              <label className="label">{createExamSource === "PDF" ? "Cavab vərəqi (JSON)" : "Cavab vərəqi (JSON)"}</label>
              <textarea
                className="input min-h-[120px] font-mono text-sm"
                placeholder='{"type":"quiz","questions":[{"no":1,"qtype":"closed","options":["A","B","C","D"],"correct":0},...]}'
                value={createExamJson}
                onChange={(e) => {
                  setCreateExamJson(e.target.value);
                  setCreateExamJsonError(null);
                }}
              />
              {createExamJsonError && (
                <p className="mt-1 text-xs text-red-600">{createExamJsonError}</p>
              )}
              {createExamJson.trim() && (() => {
                try {
                  const q = JSON.parse(createExamJson) as { type?: string; questions?: unknown[] };
                  const qs = q?.questions ?? [];
                  const closed = qs.filter((x: { qtype?: string; kind?: string }) => (x.qtype || x.kind || "").toString().toLowerCase() === "closed" || (x.qtype || x.kind) === "mc").length;
                  const open = qs.filter((x: { qtype?: string; kind?: string }) => (x.qtype || x.kind || "").toString().toLowerCase() === "open").length;
                  const sit = qs.filter((x: { qtype?: string; kind?: string }) => (x.qtype || x.kind || "").toString().toLowerCase() === "situation").length;
                  const isQuiz = (q.type || "quiz") === "quiz";
                  const need = isQuiz ? { closed: 12, open: 3, situation: 0 } : { closed: 22, open: 5, situation: 3 };
                  const ok = closed === need.closed && open === need.open && sit === need.situation;
                  return (
                    <p className={`mt-1 text-xs ${ok ? "text-green-600" : "text-amber-600"}`}>
                      Sual sayı: qapalı {closed}, açıq {open}, situasiya {sit}. {isQuiz ? "Quiz: 12+3+0" : "İmtahan: 22+5+3"}. {ok ? "Düzgündür" : "Tərkib qaydalarına uyğun yoxlayın."}
                    </p>
                  );
                } catch {
                  return null;
                }
              })()}
            </div>
          )}
          {createExamSource === "BANK" && (
            <>
              <div>
                <label className="label">Başlanğıc *</label>
                <input type="datetime-local" className="input" {...registerExam("start_time")} />
                {errorsExam.start_time && (
                  <p className="mt-1 text-xs text-red-600">{errorsExam.start_time.message}</p>
                )}
              </div>
              <div>
                <label className="label">Bitmə *</label>
                <input type="datetime-local" className="input" {...registerExam("end_time")} />
                {errorsExam.end_time && (
                  <p className="mt-1 text-xs text-red-600">{errorsExam.end_time.message}</p>
                )}
              </div>
            </>
          )}
          {(createExamSource === "JSON" || createExamSource === "PDF") && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Başlanğıc *</label>
                <input type="datetime-local" className="input" {...registerExam("start_time")} />
              </div>
              <div>
                <label className="label">Bitmə *</label>
                <input type="datetime-local" className="input" {...registerExam("end_time")} />
              </div>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-primary flex-1" disabled={createExamMutation.isPending}>
              Yadda saxla
            </button>
            <button type="button" onClick={() => setShowCreateExam(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showAddQuestions}
        onClose={() => { setShowAddQuestions(false); setAddQuestionIds([]); setExamTopicFilter(""); }}
        title="Sual əlavə et"
        size="lg"
      >
        {selectedExamId != null && (
          <>
            <div className="mb-4">
              <label className="label">Mövzu</label>
              <select
                className="input"
                value={examTopicFilter}
                onChange={(e) => setExamTopicFilter(e.target.value)}
              >
                <option value="">Hamısı</option>
                {topics.map((t) => (
                  <option key={t.id} value={String(t.id)}>{t.name}</option>
                ))}
              </select>
            </div>
            {(() => {
              const isQuiz = examDetail?.type === "quiz";
              const req = isQuiz ? { closed: 12, open: 3, situation: 0 } : { closed: 22, open: 5, situation: 3 };
              const current = {
                closed: (examDetail?.questions ?? []).filter((q: any) => q.question_type === "MULTIPLE_CHOICE").length,
                open: (examDetail?.questions ?? []).filter((q: any) => (q.question_type || "").startsWith("OPEN")).length,
                situation: (examDetail?.questions ?? []).filter((q: any) => q.question_type === "SITUATION").length,
              };
              const selectedQs = questionsForExam.filter((q) => addQuestionIds.includes(q.id));
              const sel = {
                closed: selectedQs.filter((q) => q.type === "MULTIPLE_CHOICE").length,
                open: selectedQs.filter((q) => (q.type || "").startsWith("OPEN")).length,
                situation: selectedQs.filter((q) => q.type === "SITUATION").length,
              };
              const after = { closed: current.closed + sel.closed, open: current.open + sel.open, situation: current.situation + sel.situation };
              const valid = after.closed <= req.closed && after.open <= req.open && after.situation <= req.situation &&
                (isQuiz ? after.closed + after.open + after.situation <= 15 : after.closed + after.open + after.situation <= 30);
              return (
                <>
                  <div className="text-xs text-slate-600 mb-2">
                    {isQuiz ? "Quiz: 12 qapalı + 3 açıq" : "İmtahan: 22 qapalı + 5 açıq + 3 situasiya"}. Əlavədən sonra: Qapalı {after.closed}/{req.closed}, Açıq {after.open}/{req.open}{!isQuiz ? `, Situasiya ${after.situation}/${req.situation}` : ""}
                    {!valid && addQuestionIds.length > 0 && <span className="block text-red-600 mt-1">Sual sayı qaydalara uyğun deyil</span>}
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
                    {questionsForExam
                      .filter((q) => !examQuestionIds.has(q.id))
                      .map((q) => (
                        <label key={q.id} className="flex items-center gap-2 py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={addQuestionIds.includes(q.id)}
                            onChange={(e) =>
                              setAddQuestionIds((prev) =>
                                e.target.checked ? [...prev, q.id] : prev.filter((id) => id !== q.id)
                              )
                            }
                          />
                          <span className="text-sm text-slate-800 truncate flex-1">{q.text}</span>
                          <span className="text-xs text-slate-500">{q.type}</span>
                        </label>
                      ))}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="btn-primary flex-1"
                      disabled={addQuestionIds.length === 0 || !valid || addExamQuestionMutation.isPending}
                onClick={async () => {
                  for (const questionId of addQuestionIds) {
                    await addExamQuestionMutation.mutateAsync({ examId: selectedExamId, questionId });
                  }
                  setShowAddQuestions(false);
                  setAddQuestionIds([]);
                  setExamTopicFilter("");
                  if (selectedExamId) queryClient.invalidateQueries({ queryKey: ["teacher", "exam", selectedExamId] });
                }}
              >
                Seçilənləri əlavə et ({addQuestionIds.length})
              </button>
              <button
                type="button"
                onClick={() => { setShowAddQuestions(false); setAddQuestionIds([]); setExamTopicFilter(""); }}
                className="btn-outline flex-1"
              >
                Bağla
              </button>
            </div>
                </>
              );
            })()}
          </>
        )}
      </Modal>

      <Modal
        isOpen={showExamSettings}
        onClose={() => {
          setShowExamSettings(false);
          setSelectedGroupIds([]);
          setSelectedStudentId(null);
          setExamStartTime("");
        }}
        title="İmtahanı başlat"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Müddət (dəqiqə) *</label>
            <input
              type="number"
              min={1}
              className="input w-full"
              value={examDuration}
              onChange={(e) => setExamDuration(parseInt(e.target.value, 10) || 60)}
            />
          </div>
          <div>
            <label className="label">Təyin et</label>
            <div className="flex gap-4 mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={assignMode === "groups"}
                  onChange={() => setAssignMode("groups")}
                />
                <span>Qruplar</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={assignMode === "student"}
                  onChange={() => setAssignMode("student")}
                />
                <span>Tək şagird</span>
              </label>
            </div>
            {assignMode === "groups" && (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {groups?.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(Number(g.id))}
                      onChange={(e) =>
                        setSelectedGroupIds((prev) =>
                          e.target.checked
                            ? [...prev, Number(g.id)]
                            : prev.filter((id) => id !== Number(g.id))
                        )
                      }
                    />
                    <span>{g.name}</span>
                  </label>
                ))}
              </div>
            )}
            {assignMode === "student" && (
              <select
                className="input w-full"
                value={selectedStudentId || ""}
                onChange={(e) => setSelectedStudentId(e.target.value ? parseInt(e.target.value, 10) : null)}
              >
                <option value="">Şagird seçin</option>
                {students?.map((s) => (
                  <option key={s.id} value={s.userId ?? s.id}>{s.fullName}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={
                startExamMutation.isPending ||
                !examStartTime ||
                (assignMode === "groups" && selectedGroupIds.length === 0) ||
                (assignMode === "student" && !selectedStudentId)
              }
              onClick={() => {
                if (selectedExamId) {
                  if (assignMode === "student" && selectedStudentId) {
                    startExamMutation.mutate(selectedExamId);
                  } else if (assignMode === "groups" && selectedGroupIds.length > 0) {
                    startExamMutation.mutate(selectedExamId);
                  }
                }
              }}
            >
              Başlat
            </button>
              <button
                type="button"
                onClick={() => {
                  setShowExamSettings(false);
                  setSelectedGroupIds([]);
                  setSelectedStudentId(null);
                }}
                className="btn-outline flex-1"
              >
                Ləğv et
              </button>
            </div>
          </div>
        </Modal>

      <Modal
        isOpen={showCreateRunModal}
        onClose={() => { setShowCreateRunModal(false); setCreateRunGroupId(null); setCreateRunStudentId(null); }}
        title="Yeni başlama yarat"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Müddət (dəqiqə) *</label>
            <input
              type="number"
              min={1}
              className="input w-full"
              value={examDuration}
              onChange={(e) => setExamDuration(parseInt(e.target.value, 10) || 60)}
            />
          </div>
          <div>
            <label className="label">Qrup və ya şagird</label>
            <select
              className="input w-full mb-2"
              value={createRunGroupId ?? ""}
              onChange={(e) => { setCreateRunGroupId(e.target.value ? parseInt(e.target.value, 10) : null); setCreateRunStudentId(null); }}
            >
              <option value="">Qrup seçin</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <select
              className="input w-full"
              value={createRunStudentId ?? ""}
              onChange={(e) => { setCreateRunStudentId(e.target.value ? parseInt(e.target.value, 10) : null); setCreateRunGroupId(null); }}
            >
              <option value="">və ya tək şagird</option>
              {students?.map((s) => (
                <option key={s.id} value={s.userId ?? s.id}>{s.fullName}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={createRunStartNow} onChange={(e) => setCreateRunStartNow(e.target.checked)} />
            <span>İndi başlat</span>
          </label>
          {!examComposition.canActivate && examComposition.invalidReason && (
            <p className="text-xs text-orange-600">{examComposition.invalidReason}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={createRunMutation.isPending || (!createRunGroupId && !createRunStudentId) || !examComposition.canActivate}
              onClick={() => selectedExamId && createRunMutation.mutate(selectedExamId)}
            >
              {createRunMutation.isPending ? "Yaradılır…" : "Yarat"}
            </button>
            <button type="button" onClick={() => setShowCreateRunModal(false)} className="btn-outline flex-1">Ləğv et</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!showHardDeleteModal}
        onClose={() => { setShowHardDeleteModal(null); setHardDeleteStep(1); setHardDeleteConfirm(false); setHardDeleteTyped(""); }}
        title="Tam sil (geri qaytarmaq olmaz)"
        size="sm"
      >
        {showHardDeleteModal && (
          <div className="space-y-4">
            {hardDeleteStep === 1 ? (
              <>
                <p className="text-slate-600">Bu əməliyyat geri alına bilməz. Davam etmək üçün təsdiq edin.</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hardDeleteConfirm}
                    onChange={(e) => setHardDeleteConfirm(e.target.checked)}
                  />
                  <span>Başa düşürəm, geri qaytarmaq olmaz</span>
                </label>
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setShowHardDeleteModal(null)} className="btn-outline">Ləğv et</button>
                  <button
                    type="button"
                    onClick={() => hardDeleteConfirm && setHardDeleteStep(2)}
                    disabled={!hardDeleteConfirm}
                    className="btn-primary text-red-700 border-red-300 hover:bg-red-50"
                  >
                    Növbəti
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-slate-600">Təsdiq üçün <strong>DELETE</strong> və ya element adını yazın: &quot;{showHardDeleteModal.name}&quot;</p>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="DELETE və ya element adı"
                  value={hardDeleteTyped}
                  onChange={(e) => setHardDeleteTyped(e.target.value)}
                />
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setHardDeleteStep(1)} className="btn-outline">Geri</button>
                  <button
                    type="button"
                    onClick={() => {
                      if (hardDeleteTyped === "DELETE" || hardDeleteTyped === showHardDeleteModal.name) {
                        hardDeleteMutation.mutate({ type: showHardDeleteModal.type, id: showHardDeleteModal.id });
                      }
                    }}
                    disabled={hardDeleteTyped !== "DELETE" && hardDeleteTyped !== showHardDeleteModal.name || hardDeleteMutation.isPending}
                    className="btn-primary text-red-700 border-red-300 hover:bg-red-50"
                  >
                    {hardDeleteMutation.isPending ? "Silinir…" : "Tam sil"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showCreateResult}
        onClose={() => setShowCreateResult(false)}
        title="Qiymət Əlavə Et"
        size="lg"
      >
        <form onSubmit={handleSubmitResult((v) => createResultMutation.mutate({ ...v, studentProfileId: Number(v.studentProfileId) }))} className="space-y-4">
          <div>
            <label className="label">Şagird *</label>
            <select
              className="input"
              {...registerResult("studentProfileId", { valueAsNumber: true })}
            >
              <option value={0}>Seçin</option>
              {students?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Qrup</label>
            <select className="input" {...registerResult("groupId", { valueAsNumber: true })}>
              <option value={0}>Seçin</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Test Adı *</label>
            <input className="input" {...registerResult("testName")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Xal *</label>
              <input
                type="number"
                className="input"
                {...registerResult("score", { valueAsNumber: true })}
              />
            </div>
            <div>
              <label className="label">Maks. Xal *</label>
              <input
                type="number"
                className="input"
                {...registerResult("maxScore", { valueAsNumber: true })}
              />
            </div>
          </div>
          <div>
            <label className="label">Tarix *</label>
            <input
              type="date"
              className="input"
              {...registerResult("date")}
              defaultValue={new Date().toISOString().split("T")[0]}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" className="btn-primary flex-1" disabled={createResultMutation.isPending}>
              Əlavə et
            </button>
            <button type="button" onClick={() => setShowCreateResult(false)} className="btn-outline flex-1">
              Ləğv et
            </button>
          </div>
        </form>
      </Modal>

      {/* Grading Modal */}
      <Modal
        isOpen={showGradingModal}
        onClose={() => {
          setShowGradingModal(false);
          setSelectedAttemptId(null);
          setManualScores({});
          setSituationScores({});
        }}
        title="Qiymətləndirmə"
        size="lg"
      >
        {attemptDetailLoading ? (
          <p className="text-slate-500 py-4">Yüklənir...</p>
        ) : attemptDetail ? (
          <div className="space-y-4">
            <div className="border-b border-slate-200 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{attemptDetail.examTitle}</p>
                  <p className="text-sm text-slate-600">{attemptDetail.studentName}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Avto: {attemptDetail.autoScore.toFixed(1)} / {attemptDetail.maxScore}
                  </p>
                </div>
                <div className="flex gap-2">
                  {attemptDetail.pdfUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const pdfWindow = window.open(attemptDetail.pdfUrl!, '_blank');
                        if (pdfWindow) pdfWindow.focus();
                      }}
                      className="btn-outline text-sm flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      PDF-ə bax
                    </button>
                  )}
                  {attemptDetail.canvases && attemptDetail.canvases.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (attemptDetail.canvases && attemptDetail.canvases[0]?.imageUrl) {
                          setCanvasPreviewUrl(attemptDetail.canvases[0].imageUrl);
                        }
                      }}
                      className="btn-outline text-sm flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      Canvas-a bax
                    </button>
                  )}
                </div>
              </div>
            </div>
            {attemptDetail.attemptBlueprint && attemptDetail.attemptBlueprint.length > 0 && (
              <details className="border border-slate-200 rounded-lg p-2">
                <summary className="text-sm font-medium text-slate-700 cursor-pointer">Blueprint (sual və variant sırası)</summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-600 max-h-32 overflow-y-auto">
                  {attemptDetail.attemptBlueprint.map((q, i) => (
                    <li key={i}>
                      #{q.questionNumber ?? i + 1} {q.kind}
                      {q.options?.length ? ` — variantlar: ${q.options.map((o) => o.id).join(", ")}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="max-h-96 overflow-y-auto space-y-3">
              {attemptDetail.answers.map((ans, idx) => (
                <div key={`ans-${ans.id ?? ans.questionId}-${idx}`} className="border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-slate-900 mb-1">{ans.questionText}</p>
                  <p className="text-xs text-slate-500 mb-2">Tip: {ans.questionType}</p>
                  {ans.selectedOptionId && (
                    <p className="text-xs text-slate-600 mb-1">Seçilmiş variant: {ans.selectedOptionId}</p>
                  )}
                  {ans.textAnswer && (
                    <p className="text-xs text-slate-600 mb-1 bg-slate-50 p-2 rounded">Cavab: {ans.textAnswer}</p>
                  )}
                  {ans.questionType === "SITUATION" && attemptDetail.canvases?.find((c) => c.questionId === ans.questionId)?.imageUrl && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setCanvasPreviewUrl(attemptDetail.canvases!.find((c) => c.questionId === ans.questionId)!.imageUrl!)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Qaralamaya bax
                      </button>
                      <img
                        src={attemptDetail.canvases!.find((c) => c.questionId === ans.questionId)!.imageUrl!}
                        alt="Canvas preview"
                        className="mt-1 max-h-24 rounded border border-slate-200 cursor-pointer"
                        onClick={() => setCanvasPreviewUrl(attemptDetail.canvases!.find((c) => c.questionId === ans.questionId)!.imageUrl!)}
                      />
                    </div>
                  )}
                  {ans.questionType === "SITUATION" && (attemptDetail?.situationScoringSet === "SET2" || attemptDetail?.sourceType === "pdf_json" || attemptDetail?.sourceType === "PDF" || attemptDetail?.sourceType === "JSON") && (() => {
                    const situationIndex = (attemptDetail.answers ?? []).filter((a) => a.questionType === "SITUATION").findIndex((a) => a.id === ans.id) + 1;
                    return (
                      <div className="mt-2 flex items-center gap-2">
                        <label className="text-xs text-slate-700">Situasiya balı (Set 2):</label>
                        <select
                          className="input text-sm w-24"
                          value={situationScores[situationIndex] ?? ""}
                          onChange={(e) =>
                            setSituationScores((prev) => ({ ...prev, [situationIndex]: e.target.value === "" ? 0 : parseFloat(e.target.value) }))
                          }
                        >
                          <option value="">—</option>
                          {SITUATION_MULTIPLIERS_SET2.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-slate-600">
                      Avto: {ans.autoScore.toFixed(1)}
                    </span>
                    {ans.requiresManualCheck && ans.questionType !== "SITUATION" && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-700">Manual xal:</label>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          className="input text-sm w-20"
                          value={manualScores[ans.id] ?? ans.manualScore ?? ""}
                          onChange={(e) =>
                            setManualScores((prev) => ({
                              ...prev,
                              [ans.id]: parseFloat(e.target.value) || 0,
                            }))
                          }
                        />
                        <span className="text-xs text-slate-500">(max ~{attemptDetail.maxScore === 150 ? "9" : "7"} bal)</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  if (selectedAttemptId) {
                    gradeAttemptMutation.mutate({ attemptId: selectedAttemptId, publish: false });
                  }
                }}
                disabled={gradeAttemptMutation.isPending}
                className="btn-primary flex-1"
              >
                Yadda saxla
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedAttemptId) {
                    gradeAttemptMutation.mutate({ attemptId: selectedAttemptId, publish: true });
                  }
                }}
                disabled={gradeAttemptMutation.isPending}
                className="btn-outline flex-1"
              >
                Yayımla
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGradingModal(false);
                  setSelectedAttemptId(null);
                  setManualScores({});
                  setSituationScores({});
                  setCanvasPreviewUrl(null);
                }}
                className="btn-outline"
              >
                Bağla
              </button>
            </div>
          </div>
        ) : (
          <p className="text-slate-500 py-4">Məlumat yüklənmədi</p>
        )}
      </Modal>

      <Modal
        isOpen={!!canvasPreviewUrl}
        onClose={() => setCanvasPreviewUrl(null)}
        title="Situasiya qaralama"
        size="lg"
      >
        {canvasPreviewUrl && (
          <img
            src={canvasPreviewUrl}
            alt="Canvas"
            className="w-full max-h-[70vh] object-contain rounded border"
          />
        )}
      </Modal>
    </div>
  );
}
