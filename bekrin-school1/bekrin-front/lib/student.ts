import { api } from "./api";

export interface StudentAttendance {
  date: string;
  status: "present" | "absent" | "late";
  groupName?: string;
}

export interface StudentResult {
  id: string;
  testName: string;
  score: number;
  maxScore: number;
  date: string;
  groupName?: string;
}

export interface CodingExercise {
  id: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  topicId?: number | null;
  topicName?: string | null;
  solved?: boolean;
  attemptCount?: number;
  lastSubmissionStatus?: string | null;
  lastSubmissionAt?: string | null;
  createdAt?: string | null;
  completed?: boolean;
  score?: number | null;
}

export interface CodingTaskDetail {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  starterCode: string;
  topicId?: number | null;
  topicName?: string | null;
  testCaseCount: number;
}

export interface CodingSubmissionItem {
  id: number;
  status: string;
  score?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  runtimeMs?: number | null;
  attemptNo?: number | null;
  createdAt: string;
}

export interface CodingSubmissionDetail extends CodingSubmissionItem {
  submittedCode: string;
}

export interface RunCodeResultItem {
  testCaseId?: number;
  input: string;
  expected: string;
  output?: string;
  actual?: string;
  passed: boolean;
}

export interface RunCodeResult {
  status: "OK" | "ERROR" | "success" | "error";
  results?: RunCodeResultItem[];
  passedCount?: number;
  totalCount?: number;
  output?: string;
  execution_time_ms?: number;
}

export interface StudentStats {
  missedCount: number;
  absentCount: number;
  attendancePercent: number;
}

export const studentApi = {
  getStats: () => api.get<StudentStats>("/student/stats"),
  getAttendance: () => api.get<StudentAttendance[]>("/student/attendance"),
  
  getResults: () => api.get<StudentResult[]>("/student/results"),
  
  getCodingExercises: (params?: { topic?: string; status?: string; search?: string; sort?: string }) => {
    const sp = new URLSearchParams();
    if (params?.topic) sp.set("topic", params.topic);
    if (params?.status) sp.set("status", params.status);
    if (params?.search) sp.set("search", params.search);
    if (params?.sort) sp.set("sort", params.sort);
    const qs = sp.toString();
    return api.get<CodingExercise[]>(`/student/coding${qs ? `?${qs}` : ""}`);
  },
  runCoding: (taskId: number, code: string) =>
    api.post<RunCodeResult>("/student/coding/run", { task_id: taskId, code }),
  getCodingSubmissionDetail: (taskId: number, submissionId: number) =>
    api.get<CodingSubmissionDetail>(`/student/coding/${taskId}/submissions/${submissionId}`),
  getCodingTaskDetail: (id: string) =>
    api.get<CodingTaskDetail>(`/student/coding/${id}`),
  getCodingSubmissions: (taskId: string, params?: { page?: number; page_size?: number }) => {
    const sp = new URLSearchParams();
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    const qs = sp.toString();
    return api.get<{ count: number; next: number | null; previous: number | null; results: CodingSubmissionItem[] }>(
      `/student/coding/${taskId}/submissions${qs ? `?${qs}` : ""}`
    );
  },
  submitCoding: (taskId: string, code: string) =>
    api.post<{ submissionId: number; resultStatus: string; passedCount: number; totalCases: number; score?: number; createdAt: string }>(
      `/student/coding/${taskId}/submit`,
      { code }
    ),

  // Exams (run-based: runId, examId, remainingSeconds)
  getExams: () =>
    api.get<{
      runId: number;
      examId: number;
      id: number;
      title: string;
      type: string;
      sourceType?: string;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      remainingSeconds: number;
    }[]>("/student/exams"),
  startRun: (runId: number) =>
    api.post<{
      attemptId: number;
      examId: number;
      runId: number;
      title: string;
      status: string;
      sourceType?: string;
      pdfUrl?: string | null;
      startedAt: string;
      expiresAt?: string;
      endTime: string;
      questions: {
        examQuestionId?: number;
        questionId?: number;
        questionNumber?: number;
        order?: number;
        text: string;
        type: string;
        kind?: string;
        prompt?: string;
        options: { id?: number; key?: string; text: string; order?: number }[];
      }[];
      canvases?: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }[];
    }>(`/student/runs/${runId}/start`, {}),
  getMyExamResults: (params?: { type?: "quiz" | "exam" }) => {
    const sp = new URLSearchParams();
    if (params?.type) sp.set("type", params.type);
    const qs = sp.toString();
    return api.get<{
      attemptId: number;
      examId: number;
      examTitle: string;
      examType: string;
      title: string;
      status: string;
      is_result_published: boolean;
      autoScore?: number | null;
      manualScore?: number | null;
      totalScore?: number | null;
      score?: number | null;
      maxScore: number;
      submittedAt?: string | null;
      finishedAt?: string | null;
    }[]>(`/student/exams/my-results${qs ? `?${qs}` : ""}`);
  },
  startExam: (examId: number) =>
    api.post<{
      attemptId: number;
      examId: number;
      title: string;
      status?: string;
      startedAt?: string;
      expiresAt?: string;
      endTime: string;
      questions: {
        examQuestionId: number;
        questionId: number;
        order: number;
        text: string;
        type: string;
        options: { id: number; text: string; order: number }[];
      }[];
      canvases?: { canvasId: number; questionId: number; imageUrl: string | null; updatedAt: string }[];
    }>(`/student/exams/${examId}/start`, {}),
  submitExam: (examId: number, attemptId: number, answers: {
    questionId?: number;
    questionNumber?: number;
    selectedOptionId?: number | null;
    selectedOptionKey?: string;
    textAnswer?: string;
  }[]) =>
    api.post<{ attemptId: number; autoScore: number; maxScore: number; finishedAt: string }>(
      `/student/exams/${examId}/submit`,
      { attemptId, answers }
    ),
  getExamResult: (examId: number, attemptId: number) =>
    api.get<{ attemptId: number; examId: number; title: string; autoScore: number; manualScore?: number; score: number; finishedAt: string; canvases?: { canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }[] }>(
      `/student/exams/${examId}/attempts/${attemptId}/result`
    ),
  saveCanvas: (attemptId: number, data: { questionId?: number; situationIndex?: number; imageBase64?: string; strokes?: unknown }) =>
    api.post<{ canvasId: number; questionId?: number; situationIndex?: number; imageUrl: string | null; updatedAt: string }>(
      `/student/exams/attempts/${attemptId}/canvas`,
      data
    ),
};
