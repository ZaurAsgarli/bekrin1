# Current_Prompt.md — Implementation Summary

Implementation was done in stages. Below is what was completed and what remains.

---

## PART 1 — CODING SYSTEM (COMPLETED)

### Backend

**Models (additive only):**
- **CodingTask**: indexes on `topic`, `is_active`, `order_index` (already had topic, title, description, starter_code, difficulty, points, order_index).
- **CodingTestCase**: index on `task`.
- **CodingSubmission**: added `score`; indexes on `(student, task)`, `created_at`; store all submissions (no overwrite).

**New/updated endpoints:**
- `GET/POST /api/teacher/coding` — list/create tasks (with topic, select_related).
- `GET/PATCH/DELETE /api/teacher/coding/{id}` — task CRUD.
- `GET /api/teacher/coding/topics` — list topics for dropdowns.
- `GET/POST /api/teacher/coding/{id}/testcases` — list/create test cases.
- `PATCH/DELETE /api/teacher/coding/testcases/{caseId}` — update/delete test case.
- `GET /api/teacher/coding-monitor?groupId=&topic=&page=&page_size=&sort=` — monitor with group/topic filter, paginated submissions (20 per page), ranking with `totalTasksSolved`, `totalAttempts`, `perTaskAttemptCount`, task titles.
- `GET /api/student/coding?topic=&status=` — list tasks with `solved`, `attemptCount`, `lastSubmissionStatus` (topic and status filters).
- `GET /api/student/coding/{id}` — task detail + `starterCode`, `testCaseCount`.
- `GET /api/student/coding/{id}/submissions?page=&page_size=` — paginated submission history.
- `POST /api/student/coding/{id}/submit` — body `{ "code": "..." }` — runs Python code against test cases (subprocess, timeout 5s), saves submission, returns result.

**Performance:**
- `select_related('topic')` on task list/detail.
- Indexes as above.
- Pagination on monitor submissions and student submissions.

### Frontend

- **Teacher coding page**: Topic dropdown, starter_code, points, order_index in form; per-task test cases (list, add, delete); bulk JSON import (validate then POST each test case).
- **Student coding page**: Topic and status (completed/not_completed) filters; task list with solved/attempt count; select task → detail panel with starter code, textarea, submit; paginated submission history.
- **Coding monitor page**: Group and topic filters, sort (most_solved / most_attempts), paginated submissions (20 per page).

---

## PART 2 — QUESTION BANK + EXAM SYSTEM (PARTIALLY DONE)

### Done

**New models (tests app, additive):**
- **QuestionTopic**: name, order, is_active.
- **Question**: topic (FK), text, type (MULTIPLE_CHOICE, OPEN_SINGLE_VALUE, OPEN_ORDERED, OPEN_UNORDERED, SITUATION), correct_answer (JSON), answer_rule_type (nullable), created_by, created_at, is_active; indexes on topic, type, is_active.
- **QuestionOption**: question (FK), text, is_correct, order; index on question.
- **Exam**: title, type (quiz/exam), start_time, end_time, status (draft/active/finished/archived), pdf_file (optional), created_by, is_result_published; indexes on start_time, end_time, status.
- **ExamQuestion**: exam, question, order.
- **ExamAttempt**: exam, student, started_at, finished_at, auto_score, manual_score, is_checked; indexes on student, exam.
- **ExamAnswer**: attempt, question, selected_option (nullable), text_answer (nullable), auto_score, requires_manual_check; indexes on attempt, question.

Migrations created and applied: `tests.0002_question_bank_and_exam`.

### Not done (next steps)

- **APIs**: Teacher CRUD for QuestionTopic, Question, QuestionOption; exam CRUD; assign questions to exam; student “list active exams”, “start exam”, “submit answers”; evaluation using option IDs (shuffle-safe) and open-answer rules (EXACT_MATCH, ORDERED_MATCH, UNORDERED_MATCH, NUMERIC_EQUAL).
- **Visibility**: Students see exam only if status=active and current time in [start_time, end_time]; results only if is_result_published and manual check done.
- **Situation questions**: Textarea → requires_manual_check; PDF viewer + answer fields (no drawing).
- **Frontend**: Question bank page (filter, add, JSON import); exam create (select questions, preview); student exam list, start exam (timer, shuffle options, submit); parent view published results.

---

## PERFORMANCE & HARDENING (PARTIALLY DONE)

- **Done**: Coding list/detail use select_related; monitor and student submissions paginated; DB indexes added for coding and exams.
- **To do**: Fix DRF “min_value should be an integer or Decimal instance” if it appears (use `Decimal` or int in serializers); add throttling on login/submit; cache /api/auth/me 60s on frontend; single 401 redirect (no loops); loading skeletons; optional request logging (dev).

---

## VERIFICATION CHECKLIST

- [x] Run `python manage.py migrate` (coding + tests).
- [x] Teacher: create task with topic, add test cases, bulk JSON import.
- [x] Teacher: coding monitor with group/topic/sort and pagination.
- [x] Student: filter by topic/status, open task, submit code, see submission history.
- [x] Exam: question topics/questions/exams APIs; student list active exams, start, submit (option ID shuffle + open-answer rules); parent exam results.

---

## LATEST — EXAM APIs + FRONTEND + FIXES

- **Backend**: `tests/views/exams.py` — teacher question topics, questions, exams CRUD; exam add/remove question; student list active exams, start (returns questions with options, no correct_answer), submit (evaluate by option ID + open rules in `tests/evaluate.py`); student result when published; parent `GET /parent/exam-results?studentId=`.
- **Frontend**: `/student/exams` — list, start, take (options shuffled client-side, submit by option ID), result screen; auth `/me` cache 60s; 401/403 redirect only when not already on `/login`; login page wrapped in `Suspense` for `useSearchParams`; `lib/api.ts` headers typed as `Record<string, string>`.
- **Build**: `npm run build` and `python manage.py check` pass.

---

## NEW FILES

- `bekrin-back/coding/run_code.py` — safe Python execution for test cases (subprocess, timeout).
- `bekrin-back/coding/migrations/0002_add_coding_indexes_and_score.py`
- `bekrin-back/tests/migrations/0002_question_bank_and_exam.py`
- `bekrin-back/tests/evaluate.py` — open-answer evaluation (EXACT_MATCH, ORDERED_MATCH, UNORDERED_MATCH, NUMERIC_EQUAL).
- `bekrin-back/tests/views/exams.py` — teacher + student exam APIs.
- `bekrin-front/app/(student)/student/exams/page.tsx` — student exams list, start, take, submit.

## NEW ENDPOINTS (LIST)

- GET/POST `/api/teacher/coding/topics`, GET/POST `/api/teacher/coding`, GET/PATCH/DELETE `/api/teacher/coding/{id}`
- GET/POST `/api/teacher/coding/{id}/testcases`, PATCH/DELETE `/api/teacher/coding/testcases/{caseId}`
- GET `/api/teacher/coding-monitor` (query: groupId, topic, page, page_size, sort)
- GET `/api/student/coding` (query: topic, status), GET `/api/student/coding/{id}`, GET `/api/student/coding/{id}/submissions`, POST `/api/student/coding/{id}/submit`
- GET/POST `/api/teacher/question-topics`, GET/POST `/api/teacher/questions`, GET/PATCH/DELETE `/api/teacher/questions/<id>`
- GET/POST `/api/teacher/exams`, GET/PATCH/DELETE `/api/teacher/exams/<id>`, POST/DELETE `/api/teacher/exams/<id>/questions` (add/remove question)
- GET `/api/student/exams`, POST `/api/student/exams/<id>/start`, POST `/api/student/exams/<id>/submit`, GET `/api/student/exams/<id>/attempts/<id>/result`
- GET `/api/parent/exam-results?studentId=`
