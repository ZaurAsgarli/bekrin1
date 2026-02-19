import { api } from "./api";

export interface Student {
  id: string;
  userId?: number;
  email: string;
  fullName: string;
  class?: string;
  phone?: string;
  balance: number;
  status?: "active" | "deleted";
}

/** Weekday numbers: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7 */
export const LESSON_DAY_LABELS: Record<number, string> = {
  1: "B.e",   // Bazar ertəsi (Mon)
  2: "Ç.a",   // Çərşənbə axşamı (Tue)
  3: "Ç",     // Çərşənbə (Wed)
  4: "C.a",   // Cümə axşamı (Thu)
  5: "C",     // Cümə (Fri)
  6: "Ş",     // Şənbə (Sat)
  7: "B",     // Bazar (Sun)
};

/** Derive compact day label from lesson_days (Mon=1..Sun=7). "1-4" = days 1 and 4 only. */
export function deriveDisplayNameFromDays(days: number[], startTime?: string | null): string {
  if (!days?.length) return "";
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const dayPart = sorted.join("-");
  if (startTime) {
    const t = startTime.replace(/^(\d{1,2}):(\d{2}).*/, "$1:$2");
    return `${dayPart} ${t}`.trim();
  }
  return dayPart;
}

export interface Group {
  id: string;
  name: string;
  display_name?: string | null;
  display_name_is_manual?: boolean;
  lesson_days?: number[];
  start_time?: string | null;
  studentCount?: number;
  active?: boolean;
  order?: number;
  monthly_fee?: number | null;
  monthly_lessons_count?: number;
}

export interface Payment {
  id: string;
  studentId: string;
  studentName?: string;
  groupId?: string;
  groupName?: string;
  amount: number;
  date: string;
  method: "cash" | "card" | "bank";
  status: "paid" | "pending";
  note?: string;
  paymentNumber?: string;
  sequenceNumber?: number | null;
}

export interface Notification {
  id: number;
  type: "BALANCE_ZERO" | "BALANCE_LOW";
  student?: { id: number; fullName: string } | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface TeacherStats {
  totalStudents: number;
  activeStudents: number;
  todayAttendance: number;
  codingExercisesCount: number;
}

/** Low-balance alert for teacher dashboard (balance_real <= 0). */
export interface LowBalanceNotification {
  studentId: string;
  fullName: string;
  grade: string;
  displayBalanceTeacher: number;
  realBalance: number;
  reason: string;
  groupId?: string | null;
  groupName?: string | null;
  lastLessonDate?: string | null;
}

export const teacherApi = {
  getStats: () => api.get<TeacherStats>("/teacher/stats"),

  getLowBalanceNotifications: () =>
    api.get<{ items: LowBalanceNotification[]; unread_count: number }>("/teacher/notifications/low-balance"),
  
  getNotifications: () =>
    api.get<{ notifications: Notification[]; unread_count: number }>("/teacher/notifications/"),
  
  getNotificationsCount: () =>
    api.get<{ count: number }>("/teacher/notifications/count/"),
  
  markNotificationRead: (notificationId: number) =>
    api.post(`/teacher/notifications/${notificationId}/read/`),
  
  getStudents: (status?: "active" | "deleted") => {
    const params = status ? `?status=${status}` : "";
    return api.get<Student[]>(`/teacher/students${params}`);
  },

  createStudent: (data: {
    fullName: string;
    class?: string;
    phone?: string;
    balance?: number;
  }) =>
    api.post<Student & {
      credentials?: {
        studentEmail: string;
        studentPassword: string;
        parentEmail: string;
        parentPassword: string;
      };
    }>("/teacher/students", data),
  
  updateStudent: (id: string, data: Partial<Student>) =>
    api.patch<Student>(`/teacher/students/${id}`, data),
  
  deleteStudent: (id: string) => api.delete(`/teacher/students/${id}`),

  restoreStudent: (id: string) => api.post<Student>(`/teacher/students/${id}/restore`),

  hardDeleteStudent: (id: string) => api.delete(`/teacher/students/${id}/hard`),
  
  getGroups: () => api.get<Group[]>("/teacher/groups"),
  
  createGroup: (data: { name: string; lesson_days?: number[]; start_time?: string | null; display_name?: string | null; display_name_is_manual?: boolean; monthly_fee?: number | null; monthly_lessons_count?: number }) =>
    api.post<Group>("/teacher/groups", data),
  
  updateGroup: (id: string, data: Partial<Group>) =>
    api.patch<Group>(`/teacher/groups/${id}`, data),
  
  deleteGroup: (id: string) => api.delete(`/teacher/groups/${id}`),
  
  addStudentsToGroup: (groupId: string, studentIds: string[]) =>
    api.post(`/teacher/groups/${groupId}/students`, { studentIds }),
  
  removeStudentFromGroup: (groupId: string, studentId: string) =>
    api.delete(`/teacher/groups/${groupId}/students/${studentId}`),
  
  moveStudent: (studentId: string, fromGroupId: string, toGroupId: string) =>
    api.post("/teacher/groups/move-student", {
      studentId,
      fromGroupId,
      toGroupId,
    }),
  
  getPayments: (params?: { groupId?: string; studentId?: string }) => {
    const query = new URLSearchParams();
    if (params?.groupId) query.append("groupId", params.groupId);
    if (params?.studentId) query.append("studentId", params.studentId);
    const queryString = query.toString();
    return api.get<Payment[]>(`/teacher/payments${queryString ? `?${queryString}` : ""}`);
  },
  
  createPayment: (data: {
    studentId: string;
    groupId?: string;
    amount: number;
    date: string;
    method: "cash" | "card" | "bank";
    status: "paid" | "pending";
    note?: string;
  }) => api.post<Payment>("/teacher/payments", data),
  
  deletePayment: (id: string) => api.delete(`/teacher/payments/${id}`),

  // Attendance
  getAttendanceGrid: (year: number, month: number) =>
    api.get<AttendanceGrid>(`/teacher/attendance?year=${year}&month=${month}`),
  updateAttendance: (data: {
    groupId: string;
    studentId: string;
    date: string;
    status: "present" | "absent" | "late" | "excused";
  }) => api.post("/teacher/attendance/update", data),

  // New attendance endpoints
  getAttendanceGridNew: (params: { groupId: string; from: string; to: string }) => {
    const sp = new URLSearchParams();
    sp.set("groupId", params.groupId);
    sp.set("from", params.from);
    sp.set("to", params.to);
    return api.get<AttendanceGridNew>(`/teacher/attendance/grid?${sp.toString()}`);
  },
  bulkUpsertAttendance: (data: {
    groupId: string;
    items: { studentId: string; date: string; status: AttendanceStatus }[];
  }) => api.post<{ saved: number; items: { studentId: string; date: string; status: string }[] }>("/teacher/attendance/bulk-upsert", data),
  bulkDeleteAttendance: (data: {
    groupId: string;
    items: { studentId: string; date: string }[];
  }) => api.post<{ deleted: number }>("/teacher/attendance/bulk-delete", data),
  getAttendanceMonthlyNew: (params: { groupId: string; month: string }) => {
    const sp = new URLSearchParams();
    sp.set("groupId", params.groupId);
    sp.set("month", params.month);
    return api.get<AttendanceMonthlyNew>(`/teacher/attendance/monthly?${sp.toString()}`);
  },
  markAllPresentForDate: (data: { groupId: string; date: string }) =>
    api.post<{ saved: number; items: { student_id: string; date: string; status: string }[] }>(
      "/teacher/attendance/mark-all-present",
      data
    ),
  getAttendanceDaily: (groupId: string, date: string) =>
    api.get<AttendanceDaily>(`/teacher/attendance/group/${groupId}/daily?date=${date}`),
  saveAttendance: (data: {
    date: string;
    groupId: string;
    records: { studentId: string; status: "present" | "absent" | "late" | "excused" }[];
    finalize?: boolean;
  }) => api.post<{ ok: boolean; date: string; groupId: string; saved: boolean; charged: boolean; charged_count: number; delivered_marked: boolean; charged_students?: Array<{studentId: string; oldBalance: number; newBalance: number; chargeAmount: number}>; message: string }>("/teacher/attendance/save", data),
  getAttendanceMonthly: (groupId: string, year: number, month: number) =>
    api.get<AttendanceMonthly>(
      `/teacher/attendance/group/${groupId}/monthly?year=${year}&month=${month}`
    ),
  getStudentDailyBreakdown: (
    groupId: string,
    studentId: string,
    year: number,
    month: number
  ) =>
    api.get<{
      studentId: string;
      year: number;
      month: number;
      records: { date: string; status: string | null }[];
    }>(
      `/teacher/attendance/group/${groupId}/student/${studentId}/daily?year=${year}&month=${month}`
    ),
  finalizeLesson: (data: { groupId: string; date: string }) =>
    api.post<{ ok: boolean; lesson_finalized: boolean; students_charged: number; charge_details: Array<{studentId: string; oldBalance: number; newBalance: number; chargeAmount: number}>; message: string }>("/teacher/lessons/finalize", data),
  unlockLesson: (data: { groupId: string; date: string }) =>
    api.post<{ ok: boolean; message: string }>("/teacher/lessons/unlock", data),

  // Groups - students in group
  getGroupStudents: (groupId: string) =>
    api.get<Student[]>(`/teacher/groups/${groupId}/students`),

  // Coding
  getCodingTopics: () => api.get<CodingTopic[]>("/teacher/coding/topics"),
  createCodingTopic: (data: { name: string }) => api.post<CodingTopic>("/teacher/coding/topics", data),
  getCodingTasks: (params?: { topic_id?: string; q?: string; archived?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.topic_id) sp.set("topic_id", params.topic_id);
    if (params?.q) sp.set("q", params.q);
    if (params?.archived) sp.set("archived", "1");
    const qs = sp.toString();
    return api.get<CodingTask[]>(`/teacher/coding${qs ? `?${qs}` : ""}`);
  },
  createCodingTask: (data: Partial<CodingTask>) =>
    api.post<CodingTask>("/teacher/coding", data),
  updateCodingTask: (id: string, data: Partial<CodingTask>) =>
    api.patch<CodingTask>(`/teacher/coding/${id}`, data),
  deleteCodingTask: (id: string) => api.delete(`/teacher/coding/${id}`),
  getCodingTestCases: (taskId: string) =>
    api.get<CodingTestCase[]>(`/teacher/coding/${taskId}/testcases`),
  createCodingTestCase: (taskId: string, data: { input_data: string; expected?: string; expected_output?: string; explanation?: string; order_index?: number; is_sample?: boolean }) =>
    api.post<CodingTestCase>(`/teacher/coding/${taskId}/testcases`, data),
  updateCodingTestCase: (caseId: number, data: Partial<CodingTestCase>) =>
    api.patch<CodingTestCase>(`/teacher/coding/testcases/${caseId}`, data),
  deleteCodingTestCase: (caseId: number) =>
    api.delete(`/teacher/coding/testcases/${caseId}`),

  // Coding Monitor
  getCodingMonitor: (params?: { groupId?: string; topic?: string; search?: string; page?: number; page_size?: number; sort?: string; include_run?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.groupId) sp.set("groupId", params.groupId);
    if (params?.topic) sp.set("topic", params.topic);
    if (params?.search) sp.set("search", params.search);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    if (params?.sort) sp.set("sort", params.sort);
    if (params?.include_run) sp.set("include_run", "1");
    const qs = sp.toString();
    return api.get<{
      ranking: {
        student: Student;
        groupName?: string;
        totalTasksSolved: number;
        totalAttempts: number;
        perTaskAttemptCount: Record<string, number>;
      }[];
      submissions: { count: number; next: number | null; previous: number | null; results: CodingSubmission[] };
    }>(`/teacher/coding-monitor${qs ? `?${qs}` : ""}`);
  },
  getCodingSubmissions: (params?: { taskId?: string; groupId?: string; studentId?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.taskId) sp.set("taskId", params.taskId);
    if (params?.groupId) sp.set("groupId", params.groupId);
    if (params?.studentId) sp.set("studentId", params.studentId);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{
      count: number;
      page: number;
      pageSize: number;
      next: number | null;
      previous: number | null;
      results: { id: string; taskId: string; taskTitle: string; topicName?: string; studentId: string; studentName: string; status: string; score?: number; passedCount?: number; failedCount?: number; attemptNo?: number; createdAt: string }[];
    }>(`/teacher/coding/submissions${qs ? `?${qs}` : ""}`);
  },
  getCodingSubmissionDetail: (id: string) =>
    api.get<{
      id: string;
      taskId: string;
      taskTitle: string;
      topicName?: string;
      studentId: string;
      studentName: string;
      submittedCode: string;
      status: string;
      score?: number;
      passedCount?: number;
      failedCount?: number;
      errorMessage?: string;
      runtimeMs?: number;
      attemptNo?: number;
      createdAt: string;
      detailsJson: { test_case_id: number; is_sample: boolean; passed: boolean; output?: string; expected?: string }[];
    }>(`/teacher/coding/submissions/${id}`),
  getStudentSubmissions: (studentId: string, params?: { topic?: string; taskId?: string; group_id?: string; page?: number; page_size?: number; include_run?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.topic) sp.set("topic", params.topic ?? "");
    if (params?.taskId) sp.set("taskId", params.taskId ?? "");
    if (params?.group_id) sp.set("group_id", params.group_id);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.page_size != null) sp.set("page_size", String(params.page_size));
    if (params?.include_run) sp.set("include_run", "1");
    const qs = sp.toString();
    return api.get<{
      studentId: string;
      studentName: string;
      submissions: {
        id: string;
        taskId: string;
        taskTitle: string;
        topicName?: string;
        submittedCode: string;
        status: string;
        runType?: "RUN" | "SUBMIT";
        passedCount?: number;
        totalCount?: number;
        score?: number;
        failedCount?: number;
        errorMessage?: string;
        runtimeMs?: number;
        attemptNo?: number;
        createdAt: string;
        detailsJson?: { test_case_id: number; is_sample: boolean; passed: boolean; output?: string; expected?: string }[];
      }[];
    }>(`/teacher/coding/student/${studentId}/submissions${qs ? `?${qs}` : ""}`);
  },

  // Question Bank & Exams
  getQuestionTopics: () => api.get<{ id: number; name: string; order: number; is_active: boolean }[]>("/teacher/question-topics"),
  createQuestionTopic: (data: { name: string; order?: number }) => api.post<{ id: number; name: string; order: number; is_active: boolean }>("/teacher/question-topics", data),
  deleteQuestionTopic: (id: number) => api.delete(`/teacher/question-topics/${id}`),
  getQuestions: (params?: { topic?: string; type?: string }) => {
    const sp = new URLSearchParams();
    if (params?.topic) sp.set("topic", params.topic);
    if (params?.type) sp.set("type", params.type);
    const qs = sp.toString();
    return api.get<QuestionBankItem[]>(`/teacher/questions${qs ? `?${qs}` : ""}`);
  },
  createQuestion: (data: QuestionBankCreate) => api.post<QuestionBankItem>("/teacher/questions", data),
  updateQuestion: (id: number, data: Partial<QuestionBankItem>) => api.patch<QuestionBankItem>(`/teacher/questions/${id}`, data),
  deleteQuestion: (id: number) => api.delete(`/teacher/questions/${id}`),
  getExams: () => api.get<ExamListItem[]>("/teacher/exams"),
  createExam: (data: ExamCreate) => api.post<ExamListItem>("/teacher/exams", data),
  updateExam: (id: number, data: Partial<ExamListItem>) => api.patch<ExamListItem>(`/teacher/exams/${id}`, data),
  deleteExam: (id: number) => api.delete(`/teacher/exams/${id}`),
  restoreExam: (id: number) => api.post<{ id: number; message: string }>(`/teacher/exams/${id}/restore`, {}),
  hardDeleteExam: (id: number, force?: boolean) =>
    api.delete(`/teacher/exams/${id}/hard-delete${force ? "?force=true" : ""}`),
  getArchiveExams: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: ExamListItem[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/exams${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveQuestions: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: QuestionBankItem[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/questions${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveQuestionTopics: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: { id: number; name: string }[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/question-topics${qs ? `?${qs}` : ""}`
    );
  },
  getArchivePdfs: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: TeacherPDF[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/pdfs${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveCodingTopics: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: { id: number; name: string }[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/coding-topics${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveCodingTasks: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: CodingTask[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/coding-tasks${qs ? `?${qs}` : ""}`
    );
  },
  getArchivePayments: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: Payment[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/payments${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveGroups: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: Group[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/groups${qs ? `?${qs}` : ""}`
    );
  },
  getArchiveStudents: (params?: { q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.page != null) sp.set("page", String(params.page));
    const qs = sp.toString();
    return api.get<{ items: Student[]; meta: { page: number; page_size: number; has_next: boolean } }>(
      `/teacher/archive/students${qs ? `?${qs}` : ""}`
    );
  },
  restorePayment: (id: number) => api.post<Payment>(`/teacher/payments/${id}/restore`, {}),
  restoreGroup: (id: number) => api.post<Group>(`/teacher/groups/${id}/restore`, {}),
  restoreCodingTopic: (id: number) => api.post<{ id: number; message: string }>(`/teacher/coding/topics/${id}/restore`, {}),
  hardDeleteCodingTopic: (id: number) => api.delete(`/teacher/coding/topics/${id}/hard-delete`),
  restoreCodingTask: (id: number) => api.post<{ id: number; message: string }>(`/teacher/coding/${id}/restore`, {}),
  hardDeleteCodingTask: (id: number) => api.delete(`/teacher/coding/${id}/hard-delete`),
  restoreQuestionTopic: (id: number) => api.post<{ id: number; message: string }>(`/teacher/question-topics/${id}/restore`, {}),
  hardDeleteQuestionTopic: (id: number) => api.delete(`/teacher/question-topics/${id}/hard-delete`),
  restoreQuestion: (id: number) => api.post<{ id: number; message: string }>(`/teacher/questions/${id}/restore`, {}),
  hardDeleteQuestion: (id: number) => api.delete(`/teacher/questions/${id}/hard-delete`),
  restorePdf: (id: number) => api.post<{ id: number; message: string }>(`/teacher/pdfs/${id}/restore`, {}),
  hardDeletePdf: (id: number) => api.delete(`/teacher/pdfs/${id}/hard-delete`),
  bulkDeleteExams: (ids: number[]) => api.post<{ deleted: number; message: string }>(`/teacher/archive/exams/bulk-delete`, { ids }),
  bulkDeleteQuestions: (ids: number[]) => api.post<{ deleted: number; message: string }>(`/teacher/archive/questions/bulk-delete`, { ids }),
  bulkDeletePdfs: (ids: number[]) => api.post<{ deleted: number; message: string }>(`/teacher/archive/pdfs/bulk-delete`, { ids }),
  getExamDetail: (id: number) => api.get<ExamDetail>(`/teacher/exams/${id}`),
  createExamRun: (examId: number, data: { groupId?: number; studentId?: number; duration_minutes: number; start_now?: boolean }) =>
    api.post<{ runId: number; start_at: string; end_at: string; duration_minutes: number }>(`/teacher/exams/${examId}/create-run`, data),
  getExamRuns: (examId: number) => api.get<ExamRunItem[]>(`/teacher/exams/${examId}/runs`),
  getRunAttempts: (runId: number) => api.get<{ attempts: ExamAttempt[] }>(`/teacher/runs/${runId}/attempts`),
  resetRunStudent: (runId: number, studentId: number) => api.post<{ message: string; studentId: number; runId: number }>(`/teacher/runs/${runId}/reset-student`, { studentId }),
  addExamQuestion: (examId: number, questionId: number) => api.post(`/teacher/exams/${examId}/questions`, { question_id: questionId }),
  removeExamQuestion: (examId: number, questionId: number) => api.delete(`/teacher/exams/${examId}/questions/${questionId}`),
  assignExamToGroups: (examId: number, groupIds: number[]) => api.post(`/teacher/exams/${examId}/assign`, { groupIds }),
  startExamNow: (examId: number, data: { groupIds?: number[]; studentId?: number; durationMinutes: number; startTime?: string }) =>
    api.post(`/teacher/exams/${examId}/start-now`, data),
  stopExam: (examId: number) => api.post(`/teacher/exams/${examId}/stop`),
  updateRun: (runId: number, data: { duration_minutes: number }) => api.patch(`/teacher/runs/${runId}`, data),
  getExamAttempts: (examId: number, params?: { groupId?: string; status?: string; showArchived?: boolean }) => {
    const sp = new URLSearchParams();
    if (params?.groupId) sp.set("groupId", params.groupId);
    if (params?.status) sp.set("status", params.status);
    if (params?.showArchived) sp.set("showArchived", "true");
    const qs = sp.toString();
    return api.get<{ attempts?: ExamAttempt[]; runs?: Array<{
      runId: number;
      examId: number;
      examTitle: string;
      groupName?: string | null;
      studentName?: string | null;
      startAt: string;
      endAt: string;
      durationMinutes: number;
      status: string;
      attemptCount: number;
      attempts: ExamAttempt[];
    }> }>(`/teacher/exams/${examId}/attempts${qs ? `?${qs}` : ""}`);
  },
  examAttemptsCleanup: (examId: number, data: { scope: "exam" | "group" | "student"; group_id?: number; student_id?: number; only_unpublished?: boolean }) =>
    api.post<{ archived: number; message: string }>(`/teacher/exams/${examId}/attempts/cleanup`, data),
  getAttemptDetail: (attemptId: number) => api.get<ExamAttemptDetail>(`/teacher/attempts/${attemptId}`),
  gradeAttempt: (attemptId: number, data: {
    manualScores?: Record<string, number>;
    per_situation_scores?: { index: number; fraction: number | string }[];
    publish?: boolean;
    notes?: string;
  }) =>
    api.post<{ attemptId: number; manualScore: number; autoScore: number; finalScore: number; isPublished: boolean }>(`/teacher/attempts/${attemptId}/grade`, data),
  publishAttempt: (attemptId: number, publish: boolean) => api.post(`/teacher/attempts/${attemptId}/publish`, { publish }),
  restartAttempt: (attemptId: number, durationMinutes?: number) =>
    api.post<{ message: string; studentId: number; durationMinutes: number; endTime: string }>(
      `/teacher/attempts/${attemptId}/restart`,
      { durationMinutes: durationMinutes ?? 60 }
    ),
  resetStudent: (examId: number, studentId: number, durationMinutes?: number) =>
    api.post<{ message: string; studentId: number; durationMinutes: number; endTime: string }>(
      `/teacher/exams/${examId}/reset-student`,
      { studentId, durationMinutes: durationMinutes ?? 60 }
    ),
  reopenAttempt: (attemptId: number) => api.post(`/teacher/attempts/${attemptId}/reopen`),
  getPDFs: (params?: { q?: string; year?: string; tag?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.year) sp.set("year", params.year);
    if (params?.tag) sp.set("tag", params.tag);
    const qs = sp.toString();
    return api.get<TeacherPDF[]>(`/teacher/pdfs${qs ? `?${qs}` : ""}`);
  },
  uploadPDF: (file: File, data: { title?: string; year?: number; tags?: string[]; source?: string }) => {
    const formData = new FormData();
    formData.append("file", file);
    if (data.title) formData.append("title", data.title);
    if (data.year) formData.append("year", String(data.year));
    if (data.tags && data.tags.length > 0) {
      formData.append("tags", JSON.stringify(data.tags));
    }
    if (data.source) formData.append("source", data.source);
    return api.post<TeacherPDF>("/teacher/pdfs", formData);
  },
  updatePDF: (id: number, data: Partial<TeacherPDF>) => api.patch<TeacherPDF>(`/teacher/pdfs/${id}`, data),
  deletePDF: (id: number) => api.delete(`/teacher/pdfs/${id}`),

  // Tests (legacy)
  getTests: () =>
    api.get<{ tests: Test[]; results: TestResult[] }>("/teacher/tests"),
  createTest: (data: Partial<Test>) =>
    api.post<Test>("/teacher/tests", data),
  createTestResult: (data: {
    studentProfileId: number;
    groupId?: number;
    testName: string;
    maxScore: number;
    score: number;
    date: string;
  }) => api.post("/teacher/test-results", data),

  // Bulk Import - preview then confirm
  bulkImportPreview: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<{
      preview: {
        row: number;
        fullName: string;
        grade: string | null;
        phone: string | null;
        status: "valid" | "invalid" | "duplicate_in_file" | "duplicate_in_db";
        message: string | null;
      }[];
      summary: { total: number; valid: number; invalid: number; duplicateInFile: number; duplicateInDb: number };
      validRows: { full_name: string; grade?: string | null; phone?: string | null }[];
    }>("/teacher/bulk-import/preview", formData);
  },
  bulkImportConfirm: (rows: { full_name: string; grade?: string | null; phone?: string | null }[]) => {
    return api.post<{
      created: number;
      errors: string[];
      credentials: {
        fullName: string;
        studentEmail: string;
        studentPassword: string;
        parentEmail: string;
        parentPassword: string;
      }[];
    }>("/teacher/bulk-import/confirm", { rows });
  },

  // Bulk import users (new format: fullName, grade, studentEmail, parentEmail, password)
  bulkImportUsers: (data: { file?: File; csvText?: string }) => {
    if (data.file) {
      const formData = new FormData();
      formData.append("file", data.file);
      return api.post<{
        created: number;
        skipped: number;
        errors: { row: number; field: string; message: string }[];
        credentials: { fullName: string; studentEmail: string; parentEmail: string; password: string }[];
      }>("/teacher/bulk-import/users", formData);
    }
    return api.post<{
      created: number;
      skipped: number;
      errors: { row: number; field: string; message: string }[];
      credentials: { fullName: string; studentEmail: string; parentEmail: string; password: string }[];
    }>("/teacher/bulk-import/users", { csvText: data.csvText });
  },
  getBulkImportTemplate: async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api"}/teacher/bulk-import/template-csv`, {
      credentials: "include",
      headers: { Cookie: document.cookie },
    });
    if (!res.ok) throw new Error("Template yüklənə bilmədi");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  },
  userRevealPassword: (userId: string) =>
    api.post<{ password: string; revealed: boolean; message?: string }>(
      `/teacher/users/${userId}/reveal-password`
    ),
  userResetPassword: (userId: string) =>
    api.post<{ password: string; message?: string }>(
      `/teacher/users/${userId}/reset-password`
    ),

  // Credentials registry (imported account credentials)
  getCredentials: (params?: { groupId?: string; search?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams();
    if (params?.groupId) sp.set("group_id", params.groupId);
    if (params?.search) sp.set("search", params.search);
    if (params?.page != null) sp.set("page", String(params.page));
    if (params?.pageSize != null) sp.set("page_size", String(params.pageSize));
    const qs = sp.toString();
    return api.get<{
      count: number;
      next: string | null;
      previous: string | null;
      results: CredentialRecord[];
    }>(`/teacher/credentials${qs ? `?${qs}` : ""}`);
  },
  revealCredential: (id: number) =>
    api.post<CredentialRecord & { studentPassword?: string; parentPassword?: string }>(
      `/teacher/credentials/${id}/reveal`
    ),
  exportCredentialsCsv: async (params?: { groupId?: string; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.groupId) sp.set("group_id", params.groupId);
    if (params?.search) sp.set("search", params.search);
    const qs = sp.toString();
    const path = `/teacher/credentials/export.csv${qs ? `?${qs}` : ""}`;
    const blob = await api.getBlob(path);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "credentials_export.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

export interface CredentialRecord {
  id: number;
  studentFullName: string;
  grade: string | null;
  studentEmail: string;
  parentEmail: string;
  groups: string[];
  createdAt: string;
  createdByTeacher: string | null;
}

// Attendance types
export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export interface AttendanceDaily {
  date: string;
  groupId: string;
  groupName: string;
  students: { id: string; fullName: string; email: string; status: AttendanceStatus }[];
}

export interface AttendanceMonthly {
  year: number;
  month: number;
  groupId: string;
  groupName: string;
  students: {
    id: string;
    fullName: string;
    email: string;
    present: number;
    absent: number;
    late: number;
    excused: number;
    attendancePercent: number;
  }[];
}

export interface AttendanceGrid {
  year: number;
  month: number;
  dates: string[];
  groups: {
    id: string;
    name: string;
    students: {
      id: string;
      fullName: string;
      email: string;
      records: Record<string, "present" | "absent" | "late" | "excused" | null>;
    }[];
  }[];
}

export interface AttendanceGridNew {
  dates: string[];
  students: { id: string; full_name: string }[];
  records: { student_id: string; date: string; status: AttendanceStatus }[];
}

export interface AttendanceMonthlyNew {
  month: string;
  dates: string[];
  students: { id: string; full_name: string }[];
  records: { student_id: string; date: string; status: AttendanceStatus }[];
  stats: {
    student_id: string;
    present: number;
    late: number;
    absent: number;
    excused: number;
    missed_count: number;
    missed_percent: number;
  }[];
}

export interface CodingTopic {
  id: number;
  name: string;
}

export interface CodingTask {
  id: string;
  topic?: number | null;
  topic_name?: string | null;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  starter_code?: string;
  points?: number | null;
  is_active?: boolean;
  order_index?: number | null;
  created_at?: string;
}

export interface CodingTestCase {
  id: number;
  input_data: string;
  expected: string;
  expected_output?: string;
  explanation?: string | null;
  order_index?: number | null;
  is_sample?: boolean;
  created_at?: string;
}

export interface CodingSubmission {
  id: string;
  taskTitle: string;
  studentName: string;
  status: string;
  createdAt: string;
  passedCount?: number | null;
  totalCount?: number | null;
}

export interface Test {
  id: string;
  type: "quiz" | "exam";
  title: string;
  pdf_url?: string;
  is_active?: boolean;
}

export interface TestResult {
  id: string;
  testName: string;
  score: number;
  maxScore: number;
  date: string;
  groupName?: string;
}

export interface QuestionBankItem {
  id: number;
  topic: number;
  text: string;
  type: string;
  correct_answer?: unknown;
  answer_rule_type?: string | null;
  created_at?: string;
  is_active?: boolean;
  options?: { id: number; text: string; is_correct: boolean; order: number }[];
}

export interface QuestionBankCreate {
  topic: number;
  text: string;
  type: string;
  correct_answer?: unknown;
  answer_rule_type?: string | null;
  is_active?: boolean;
  options?: { text: string; is_correct: boolean; order?: number }[];
}

export interface ExamListItem {
  id: number;
  title: string;
  type: "quiz" | "exam";
  source_type?: "BANK" | "PDF" | "JSON";
  start_time: string;
  end_time: string;
  status: string;
  pdf_file?: string | null;
  pdf_document?: number | null;
  is_result_published?: boolean;
  is_ghost?: boolean;
  created_at?: string;
}

export interface ExamCreate {
  title: string;
  type: "quiz" | "exam";
  source_type?: "BANK" | "PDF" | "JSON";
  start_time: string;
  end_time: string;
  status?: string;
  question_ids?: number[];
  pdf_id?: number;
  answer_key_json?: Record<string, unknown>;
  json_import?: Record<string, unknown>;
}

export interface ExamRunItem {
  id: number;
  exam: number;
  group?: number | null;
  student?: number | null;
  group_name?: string | null;
  student_name?: string | null;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  status: string;
  created_at?: string;
  attempt_count?: number;
}

export interface ExamDetail extends ExamListItem {
  questions?: { id: number; question: number; question_text: string; question_type: string; order: number }[];
  assigned_groups?: { id: number; name: string }[];
  duration_minutes?: number;
  pdf_url?: string | null;
  has_answer_key?: boolean;
  question_counts?: { closed: number; open: number; situation: number; total: number } | null;
  /** Teacher-only: Cavab vərəqi panel (PDF/JSON) */
  answer_key_preview?: { number?: number; kind: string; correct?: string; open_answer?: string }[] | null;
  runs?: ExamRunItem[];
}

export interface TeacherPDF {
  id: number;
  title: string;
  file: string;
  file_url?: string;
  original_filename?: string;
  file_size?: number;
  file_size_mb?: number;
  page_count?: number;
  tags?: string[];
  year?: number;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExamAttempt {
  id: number;
  studentId: number;
  studentName: string;
  groupId?: number;
  groupName?: string;
  status?: string;
  startedAt: string;
  finishedAt?: string;
  submittedAt?: string;
  autoScore: number;
  manualScore?: number;
  finalScore: number;
  maxScore: number;
  manualPendingCount: number;
  isChecked: boolean;
  isPublished: boolean;
}

export interface ExamAttemptDetail {
  attemptId: number;
  examId: number;
  examTitle: string;
  sourceType: "BANK" | "PDF" | "JSON";
  studentId: number;
  studentName: string;
  runId?: number | null;
  pdfUrl?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  autoScore: number;
  manualScore?: number | null;
  maxScore: number;
  attemptBlueprint?: Array<{ questionNumber?: number; questionId?: number; kind: string; options?: Array<{ id: string; text: string }>; correctOptionId?: string }> | null;
  answers: Array<{
    id: number;
    questionId?: number | null;
    questionNumber?: number | null;
    questionText: string;
    questionType: string;
    selectedOptionId?: number | null;
    selectedOptionKey?: string | null;
    textAnswer?: string | null;
    autoScore: number;
    requiresManualCheck: boolean;
    manualScore?: number | null;
  }>;
  canvases?: Array<{
    canvasId: number;
    questionId?: number | null;
    situationIndex?: number | null;
    imageUrl?: string | null;
    updatedAt: string;
  }>;
  situationScoringSet?: "SET1" | "SET2";
}
