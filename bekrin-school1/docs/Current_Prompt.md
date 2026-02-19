✅ PROMPT 1/6 — Teacher-only exam review (student/parent cannot reopen after submit)

Paste to Cursor (English):

You are working on BekrinSchool (Django DRF + Next.js 14). Implement strict access rules:

Goal

After a student submits an exam attempt:

Student must NOT be able to reopen and view the exam questions anymore (no review mode).

Parent must NOT be able to open exam attempt details/questions either.

Only Teacher can review attempts/questions/answers (including PDF canvases) inside teacher panel.

Student/Parent can only see:

in student: their score/status (e.g., “Pending manual grading”, “Published result: 120/150”) but no questions/options after submission.

in parent: published summary only.

Required changes (backend)

Identify the endpoints that return exam attempt details and/or exam questions:

student start endpoint returns questions → allowed only while attempt is active AND not submitted.

student result endpoint should return score breakdown but must not include questions/options after submission.

Add a single source of truth on ExamAttempt:

submitted_at (timestamp, null until submit)

is_result_published (bool)

manual_grading_required (bool) or derived from presence of situation questions

Enforce rules in DRF permissions / queryset filters:

Student can access:

list active exams (no correct answers)

start attempt (only once; re-open allowed only until submit and within time)

submit attempt

fetch result only if:

is_result_published == true OR show minimal status info if not published (no questions)

Parent can access only:

list child published attempts summary

attempt result summary (published only) — no questions

Teacher can access:

full attempt detail including answers, question text, option mapping, PDF links, and canvas drawings

Add robust checks:

If student tries to open attempt after submitted_at → return 403 with message “Exam review is disabled”.

If time window ended before submit, still allow submit if attempt started and within allowed grace? (choose strict: block submit after end_time unless already started; document)

Ensure responses never leak:

correct answers

full question list for student/parent after submit

Required changes (frontend)

Student UI:

After submit → redirect to /student/exams or result page showing only:

autoScore/maxScore

“pending manual grading” status if manual part exists

“result published” status

Remove any component that fetches questions after submission.

If API returns 403 “review disabled” show a friendly message (Azerbaijani) and button “Geri qayıt”.

Parent UI:

Show only published summary; if user tries to open details route, block in UI and rely on backend 403 too.

Testing checklist you must run

Create exam with mixed question types including situation.

Start attempt as student, submit.

Confirm student cannot fetch exam questions after submit (via UI + direct API call).

Confirm parent cannot view attempt details (only summary).

Confirm teacher can view everything.

Confirm no endpoint includes correct answers in student/parent responses.

Constraints

Do NOT do a large refactor.

Do NOT break existing endpoints; adjust serializers/permissions and frontend conditionally.

Keep Azerbaijani UI strings; only add new ones where needed.

Deliverables

List of files changed

Short explanation of rule enforcement locations

Manual smoke test steps and expected results

You are improving BekrinSchool exams. Implement a complete PDF-based exam pipeline with strict rules and good UX. Stack: Django DRF + Next.js 14.

0) Definitions

We support exam creation modes (later): for this prompt focus on PDF Exam.

PDF Exam means:

Teacher uploads a PDF file (question booklet or exam pages).

Teacher must also upload a JSON answer key file (required), which includes:

question number → type → correct answer (if auto-gradable) → max points/weight

question types include: MCQ, OPEN_SINGLE, SITUATION

Student takes the exam in a PDF viewer with:

pages shown (mobile-friendly)

per-page canvas area for scratch/work (like white margin) OR drawing directly over PDF (choose simplest reliable: overlay canvas layer; optional white margin)

an Answer Sheet drawer (toggle button open/close) to enter answers for MCQ and OPEN_SINGLE

For SITUATION questions: student must have a canvas-based response area (drawing/writing) and submit images (or vector strokes) saved to DB.

Security rule: After submit, student/parent cannot reopen questions (handled in Prompt 1). Teacher can review.

1) Backend — Models / Storage
1.1 PDF library (Teacher-owned)

Create or confirm models for teacher PDF assets:

TeacherPDF (or similar):

id

title

file (FileField)

uploaded_by (teacher user)

created_at

is_archived (bool, default false)

must persist until teacher deletes (no auto delete)

store files in MEDIA (dev served) and proper persistent path in prod config.

1.2 PDF Answer Key asset

Add a model to store JSON answer keys linked to a PDF:

TeacherPDFAnswerKey

pdf FK to TeacherPDF

json_file (FileField) OR json_data (JSONField) (prefer JSONField + also keep original file optional)

version int (increment on re-upload)

created_at

uploaded_by

Rule: PDF exam cannot be activated unless it has an answer key.

1.3 Exam + Attempt data for PDF mode

Extend existing Exam model to support mode:

mode = QUESTION_BANK | PDF | JSON
For this prompt implement PDF mode:

pdf FK nullable

answer_key FK nullable

max_score computed:

Quiz (15 q): default 100

Exam (30 q): default 150

duration_minutes

status: draft/active/finished/archived (already exists)

assigned_groups (many-to-many to Group) (already partly exists per prior summary)

Attempt:

ExamAttempt should store:

answers_json (JSONField) for MCQ/open-single answers from answer sheet

canvas_pages (related model) storing canvas output per page:

AttemptCanvasPage:

attempt FK

page_number int

image (ImageField) OR strokes JSON (choose simplest: PNG image upload)

created_at

manual_scores_json (JSONField) to store teacher scoring per situation question

auto_score numeric

final_score numeric

submitted_at

is_result_published

2) Backend — JSON Answer Key format (strict)

Implement a parser + validator for uploaded answer key JSON. Require this schema:

{
  "meta": {
    "exam_type": "QUIZ" | "EXAM",
    "pdf_pages": 12
  },
  "questions": [
    {
      "no": 1,
      "type": "MCQ",
      "correct": "A",
      "points": 1
    },
    {
      "no": 13,
      "type": "OPEN_SINGLE",
      "rule": "EXACT_MATCH" | "ORDERED_MATCH" | "UNORDERED_MATCH" | "NUMERIC_EQUAL",
      "correct": "135",
      "points": 1
    },
    {
      "no": 28,
      "type": "SITUATION",
      "points": 2
    }
  ]
}


Rules:

QUIZ must contain exactly:

12 MCQ

3 OPEN_SINGLE

0 SITUATION

EXAM must contain exactly:

22 MCQ

5 OPEN_SINGLE

3 SITUATION

Enforce counts during activation (status->active) and show clear error.

Points:

Base totals are 100 (quiz) or 150 (exam) before situation multiplier adjustments.

Situation questions should be worth 2x normal (we’ll implement scoring ladder in Prompt 4, but store points now).

OPEN_SINGLE evaluation:

Use your existing normalization logic (trim spaces, commas, etc).

For ORDERED_MATCH: “1,3,5” equals “135” and “1 3 5” and “1, 3, 5” but NOT “153”.

For UNORDERED_MATCH: 1,3,5 equals any permutation.

For NUMERIC_EQUAL: treat “15” different from “1,5”.

Implement this in backend utils tests/pdf_answer_key.py or similar with unit tests.

3) Backend — APIs
3.1 Teacher APIs (PDF library)

POST /api/teacher/pdfs (multipart): upload PDF, title optional

GET /api/teacher/pdfs?archived=false&search=&page= list, paginate, filter, sort newest

PATCH /api/teacher/pdfs/{id} rename or archive/unarchive

DELETE /api/teacher/pdfs/{id} hard delete (double-confirm UI; if deleted remove file)

3.2 Teacher upload answer key

POST /api/teacher/pdfs/{id}/answer-key (multipart json file OR JSON body):

validate schema & counts

create new version

GET /api/teacher/pdfs/{id}/answer-key returns latest parsed meta + questions summary

3.3 Teacher create exam from PDF

POST /api/teacher/exams accepts:

mode="PDF"

pdf_id

duration_minutes

assigned_group_ids (optional)

max_score auto by exam_type in answer key or teacher choose (default rule above)

Exam cannot be activated unless:

has pdf

has answer key

has groups assigned

has duration_minutes

3.4 Teacher activation “start now”

POST /api/teacher/exams/{id}/start-now

body: group_ids, duration_minutes

sets status=active

sets start_time = now, end_time = now + duration

but must not remove prior group assignments for other runs; allow multiple runs:

introduce ExamRun model:

exam FK

groups M2M

start_time, end_time

created_by

status active/finished

student sees exam if their group in an active run window

If you already have assigned_groups on Exam, do NOT overwrite for each run; use ExamRun.

3.5 Student APIs for PDF exams

GET /api/student/exams should include PDF exams available for their groups (active runs only)

POST /api/student/exams/{id}/start

creates attempt if not exists for the run

returns:

pdf_url

answer_sheet schema (question numbers and types but NOT correct)

show only required fields to render sheet

POST /api/student/exams/{id}/submit

accept:

answers_json (MCQ selections + open answers)

canvas_pages[] (multipart images with page_number)

compute auto_score for MCQ + OPEN_SINGLE using answer key

mark submitted_at

if situation exists, set status “pending_manual”

store results

3.6 Teacher grading for situation + adjustments

GET /api/teacher/exams/{id}/attempts?group_id=&status= list with:

student name, group, submitted_at, auto_score, pending/manual status

GET /api/teacher/exams/{id}/attempts/{attemptId} detail includes:

pdf link

student answers_json

auto grading breakdown

canvas images per page

POST /api/teacher/exams/{id}/attempts/{attemptId}/grade

body: per-situation score (we implement ladder later) and optional small adjustments to auto-graded items

compute final_score (cap at max_score)

POST /api/teacher/exams/{id}/attempts/{attemptId}/publish

sets is_result_published true

3.7 Parent

GET /api/parent/exam-results?studentId= returns only summary and published scores (no pdf/questions)

4) Frontend — Teacher UX
4.1 Question Bank page changes

Teacher wants PDF upload + question creation in the SAME page:

On /teacher/question-bank:

top tabs: Questions | PDF Library | Archived

In PDF Library:

search + filters in single row (responsive)

upload PDF section at bottom

list of existing PDFs (persist)

for each PDF:

upload answer-key JSON (required)

show “Answer key: OK / Missing”

open/view PDF button

create exam from PDF button

4.2 Tests/Exams page redesign

Teacher wants:

Separate views:

Exam Bank (created exams templates)

Active Runs (currently active exams per group)

Submissions (attempts grouped by group)

Show per exam:

mode (QuestionBank/PDF/JSON)

counts of types (22/5/3 etc)

assigned groups

duration

status

“Start now” flow:

choose groups

enter duration

click Start → creates ExamRun

Student attempts should appear live in submissions list by group (poll or refetch every 5-10s).

4.3 PDF viewer route

Implement a student exam taking screen:

shows PDF pages (use react-pdf or existing viewer)

“Answer Sheet” toggle button opens drawer:

MCQ: select A/B/C/D

OPEN_SINGLE: text input

Canvas:

For each PDF page show overlay canvas (simple) OR a “Scratch” canvas per page below.

Save canvas pages on submit only (images).

Mobile-first:

large touch buttons

drawer full screen on mobile

5) Frontend — Student & Parent

Student:

/student/exams list active

start → exam taking screen

submit → show summary only (no review)
Parent:

show published results only, no questions

6) Persistence / “PDFs disappear” bug fixes

Ensure:

Backend serves media in dev (urlpatterns += static(...))

Teacher PDF list returns stable URLs, stored in DB

Frontend uses absolute URLs correctly

Verify upload saves file and DB record; it remains after restart

7) Constraints

Avoid big refactor; integrate into existing apps (tests/ coding already exist)

Keep Azerbaijani UI strings

Do not break existing question bank exam flow

Use pagination everywhere lists exist

Add DB indexes where needed (pdf uploaded_by, created_at, examrun time filters)

8) Deliverables

Files changed list

API endpoints summary

How to manually test PDF pipeline end-to-end:

upload PDF + JSON

create exam

start now for group

student starts + submits with canvas

teacher reviews + grades + publishes

student/parent see only summary

You are improving BekrinSchool exams. Implement 3 exam creation modes with a clean teacher UX and strict rules. Stack: Django DRF + Next.js 14. Keep changes surgical (no messy UI, no breaking existing flows).

0) Goal

Teacher must be able to create exams in one unified “Exams” system with these modes:

QuestionBank mode
Teacher selects questions from internal question bank (topic grouped), options shuffle for student view, grading via optionId.

PDF mode
Teacher uses uploaded PDF + required JSON answer key file. Student answers via Answer Sheet + Canvas (handled in Prompt 2).

JSON-only mode
Teacher imports the full exam from JSON (no PDF). This is like “online exam” where all questions are defined in JSON and stored into DB as exam questions.

Teacher wants:

Question Bank page can still exist, but exam creation should allow selecting any mode.

Strong filtering/search so topics/questions are easy to find.

Teacher must be able to edit questions (fix mistakes).

Composition rules must be enforced (Quiz 15; Exam 30).

1) Backend — Data model adjustments
1.1 Exam model

Ensure Exam has:

mode: QUESTION_BANK | PDF | JSON

status: draft | active | finished | archived

duration_minutes

max_score default logic: quiz=100 exam=150

created_by teacher user

created_at

Keep existing fields; add only what missing.

1.2 ExamRun model (must exist now)

To avoid “starting one group hides the other” problem, implement ExamRun:

exam FK

groups M2M

optional students M2M (for “single student run”)

start_time, end_time

created_by

status active/finished
Rule: An exam can have multiple runs; each run is independent. Student sees exam if:

their group in run.groups OR they are in run.students

now within start/end window

they have not already submitted for that run (unless teacher resets that student)

1.3 Question bank structure

We already have question topics and questions, but improve:

QuestionTopic: name, order, is_archived

Question:

topic FK

type: MCQ | OPEN_SINGLE | SITUATION

prompt text (Azerbaijani supported)

optional explanation

difficulty optional

tags optional (ArrayField or JSONField)

is_archived

created_at

QuestionOption for MCQ: id, label A/B/C/D not stored as truth; store option text; correct option is stored by option id.

OpenAnswerRule: EXACT_MATCH/ORDERED_MATCH/UNORDERED_MATCH/NUMERIC_EQUAL (existing evaluate.py logic should be reused).

IMPORTANT: Editing must be supported. When teacher edits a question that is already used in an exam:

If exam is draft → reflect changes.

If exam has active/finished runs → do NOT mutate historical attempt grading. Either:

snapshot question content into ExamQuestionSnapshot, or

lock editing for questions that are in non-draft exams.
Choose minimal safe approach:

For now: if question is used by an exam that is not draft, show warning and require duplication (copy) instead of edit. Implement endpoint “duplicate question”.

1.4 JSON-only exam content

Create ExamQuestion model to store questions attached to an exam when mode = JSON:

exam FK

question_no int

type

prompt

options array (for MCQ)

correct (for auto-gradable)

open_rule (for OPEN_SINGLE)

points

order_index

is_situation bool
This is internal to the exam, separate from bank.

For QUESTION_BANK mode you can either:

reference bank questions directly OR snapshot to ExamQuestion too.
Prefer snapshot for stability if you can without big refactor:

ExamQuestion can include source_question_id nullable.

2) Backend — APIs
2.1 Teacher — Unified exam endpoints

GET /api/teacher/exams?status=&mode=&search=&page= list + pagination

POST /api/teacher/exams create:

accepts mode, title, duration_minutes, max_score (optional), plus mode-specific payload:

mode=QUESTION_BANK: no questions at creation time; add later

mode=PDF: pdf_id, answer_key_id

mode=JSON: exam_json OR uploaded json file

GET /api/teacher/exams/{id} detail includes:

mode, status, duration, max_score, composition counts

for QUESTION_BANK: list attached questions + per-type counts

for PDF: pdf meta + answer key summary

for JSON: list exam questions

PATCH /api/teacher/exams/{id} update metadata, status (draft/archived), duration

DELETE /api/teacher/exams/{id} should NOT hard delete; move to archive (soft). Teacher can later hard-delete in Archive tab.

2.2 Teacher — attach/detach questions (QUESTION_BANK)

POST /api/teacher/exams/{id}/questions

body: question_ids[]

attaches snapshot or reference

DELETE /api/teacher/exams/{id}/questions/{examQuestionId or questionId}

POST /api/teacher/exams/{id}/auto-compose

body: topic_id or multiple topic ids, and exam_type quiz/exam

auto picks questions by required counts:

quiz: 12 mcq + 3 open

exam: 22 mcq + 5 open + 3 situation

Must enforce “topic coverage”: choose only from selected topics; if insufficient questions, return precise error (how many missing per type).

Random selection should be stable/seeded per exam (store seed).

2.3 Teacher — JSON import

POST /api/teacher/exams/{id}/import-json (for mode JSON)

validate JSON schema:

{
  "meta": { "exam_type": "QUIZ|EXAM", "title": "..." },
  "questions": [
    { "no": 1, "type": "MCQ", "prompt": "...", "options": ["...","...","...","..."], "correctIndex": 2, "points": 1 },
    { "no": 13, "type": "OPEN_SINGLE", "prompt": "...", "rule": "ORDERED_MATCH", "correct": "135", "points": 1 },
    { "no": 28, "type": "SITUATION", "prompt": "...", "points": 2 }
  ]
}


store into ExamQuestion rows

2.4 Teacher — Question bank editing + filtering

GET /api/teacher/question-topics?search=&archived= list

POST /api/teacher/question-topics

PATCH /api/teacher/question-topics/{id}

POST /api/teacher/questions create

GET /api/teacher/questions?topic_id=&type=&search=&tag=&archived=&page=

PATCH /api/teacher/questions/{id} edit with rules above

POST /api/teacher/questions/{id}/duplicate

DELETE /api/teacher/questions/{id} archive (soft)

POST /api/teacher/questions/{id}/restore

3) Strict composition enforcement (must be visible in UI)

For every exam, compute counters:

mcq_count, open_count, situation_count
And enforce:

QUIZ: 12/3/0 total 15

EXAM: 22/5/3 total 30

Rules:

Exam cannot be started (create ExamRun) unless composition is correct AND duration set AND target group/student selected.

UI must show counters in color:

green when matches requirement

orange/red when mismatch

Also show “Who can access”:

group(s) and/or student(s)

start/end time for each run

4) Frontend — Teacher UX redesign (minimal but clean)
4.1 Exams page layout

/teacher/tests should become a clean system:

Top tabs:

Exam Bank (all exams templates; filter by mode/status)

Active Runs (runs currently active; grouped by exam then group)

Submissions (attempts; filter by exam/run/group/student; show live submitted count)

Archive (archived exams + restore/hard delete)

Filters must be in ONE ROW, responsive:

search input

status dropdown

mode dropdown

sort dropdown (newest, last active, most submissions)

4.2 Create exam button

Button “Yeni imtahan” opens modal with:

Title

Mode selector: Question Bank / PDF / JSON

Exam type selector: Quiz (15) or Exam (30)

Duration minutes

Max score auto fill (100/150) but allow override (teacher may change later)

Mode-specific:

Question Bank: choose topics (multi-select) and option “Auto compose now”

PDF: choose existing PDF + upload/select answer key (must show “OK”)

JSON: upload JSON file or paste JSON

After create, navigate to detail screen.

4.3 Exam detail screen

Show:

metadata

composition counters

list of questions (for QB/JSON)

PDF preview link (for PDF)

buttons:

“Add questions” (QB)

“Import JSON” (JSON)

“Upload answer key” (PDF)

“Start now” (creates run)

“Archive”

“Start now” modal:

choose groups (multi) OR single student

duration (default from exam)

confirm
Creates ExamRun; displays run card with timer end.

5) Student visibility logic

Student sees exams only if:

active run exists and time window active

they are in the run’s group or target student list

they haven’t submitted for that run (unless reset)
And after submit, they cannot open again (Prompt 1 rules).

6) DB / Data Integrity

Ensure Azerbaijani characters work: use UTF-8 (Postgres default), do not use ascii-only transforms.

Ensure imported JSON text is stored losslessly.

7) Manual Testing checklist (teacher)

Create QB exam (quiz) → auto-compose from topic → counters correct

Create PDF exam → upload PDF + answer key → start for group

Create JSON exam → import JSON → start for group

Start same exam for another group later → previous run remains, submissions remain

Archive exam → appears in Archive; restore works

Edit a bank question used in active exam: should force duplicate, not mutate history

8) Deliverables

Updated endpoints summary

UI screenshots not required, but route behaviors must match

No big refactor, but clean code

When done, run:

backend: manage.py check + migrate + runserver

frontend: npm run build + npm run dev
Fix any errors you encounter.

Return a concise implementation report.

You are continuing BekrinSchool exams. Implement the student + parent UX and teacher grading workflow for all exam modes (QuestionBank / PDF+JSON / JSON-only). Keep changes clean (no ugly patches), but refactor if needed for correctness. Do not break existing attendance/payments/coding.

0) Requirements recap (must implement)
Exam types & composition rules

QUIZ (15 questions): 12 closed (MCQ) + 3 open (OPEN_SINGLE). No situation.

EXAM (30 questions): 22 closed (MCQ) + 5 open (OPEN_SINGLE) + 3 situation (SITUATION) which require canvas work and teacher manual grading.

Scoring rules

Quiz default max_score=100

Exam default max_score=150

Per-question points can be computed automatically:

Quiz: each question equal = 100/15 (store decimal, round only at final)

Exam: base points = 150 / (22 + 5 + 3*2) because situation counts as double weight (each situation = 2x normal)

Alternatively implement explicit points per question when composing/importing; but MUST keep situation weight = 2x final effect.

Teacher manual grading:

Situation score per situation uses ladder: 0, 1/2, 2/3, 1, 4/3, 2 * basePoint OR implement as fraction choices (0, 1/2, 2/3, 1, 4/3, 2).

Teacher must be able to slightly adjust auto-graded scores for non-situation questions too, but total must not exceed exam max_score.

Visibility rules

Students/parents cannot reopen the exam content after submit.

Students/parents should only see:

Their result summary (score, breakdown, status)

Their own submitted answers (optional) ONLY if teacher has published results

They should not see questions after the window or after submit.

Option shuffle correctness

Student UI must shuffle MCQ options, but grading must remain correct:

Submit must send selectedOptionId (option row id), not letter A/B/C/D.

UI may display A/B/C/D based on shuffled order, but never store letter as truth.

Situation canvas

For situation questions, student must have:

A canvas drawing area (mobile friendly) like “white sheet” to write with finger/stylus.

Ability to zoom/scroll without breaking drawing.

Save per situation question.

Canvas data must be stored server-side linked to attempt + question_no.

Teacher must see these canvases and grade each situation question.

Parent/student later see only score summary + teacher feedback (optional), not necessarily the full canvas (depending on publish). Default: don’t show canvases to student/parent after submit; teacher-only.

PDF exams

In PDF mode, student sees:

The PDF viewer

An “Answer Sheet” panel that can open/close:

For MCQ: radio buttons per question number

For OPEN_SINGLE: text input

For SITUATION: canvas pages (per situation question OR per page sections)

The answer key JSON defines question types and correct answers.

1) Backend — Attempt model + answers storage

Ensure attempt storage supports all modes:

1.1 ExamAttempt

Fields:

exam_run FK (NOT only exam)

student FK

started_at, submitted_at

status: in_progress | submitted | graded | published

auto_score (decimal)

manual_score (decimal)

final_score (decimal)

max_score (decimal)

breakdown JSON (counts correct, incorrect, missing per type)

is_result_published bool (or status published)

Constraints:

unique(student, exam_run)

1.2 ExamAnswer

Store each answer:

attempt FK

question_no

type

selected_option_id nullable

text_answer nullable

is_correct nullable

auto_points (decimal)

manual_points (decimal)

final_points (decimal)

teacher_note text nullable

For situation:

store situation_canvas_id or direct FK to a canvas table.

1.3 SituationCanvas

attempt FK

question_no

image_data (base64 png) OR store file in MEDIA with path

updated_at

IMPORTANT: Use MEDIA serving already configured; ensure stable URLs.

2) Backend — Evaluation logic upgrades (OPEN rules)

Currently evaluate.py handles:

EXACT_MATCH

ORDERED_MATCH

UNORDERED_MATCH

NUMERIC_EQUAL

Upgrade input normalization:

Strip spaces, allow “1,3,5” “1 3 5” “135”

For ORDERED_MATCH: order must be same, but allow separators.

For UNORDERED_MATCH: order irrelevant, duplicates handled.

For NUMERIC_EQUAL: “15” ≠ “1,5”, “1.5” handling optional.

Teacher enters only one correct pattern; system must accept equivalent patterns based on rule.

Add robust parsing function:

Extract digits sequences; handle multi-digit tokens (15 vs 1,5).

Use configured rule to interpret tokens.

3) Backend — Student endpoints

Implement/confirm these endpoints:

3.1 List active exams

GET /api/student/exams

Must filter by active runs:

now between run.start_time and run.end_time

student in run.groups or run.students

attempt not submitted
Return list: run_id, exam_id, title, ends_at, duration_minutes, mode, exam_type, max_score

3.2 Start exam

POST /api/student/exam-runs/{run_id}/start

Creates attempt if not exists (in_progress)

Returns payload depends on mode:

QUESTION_BANK/JSON: questions with options (no correct answers)

PDF: pdf_url + answer_sheet schema from answer key JSON (question_no/type/optionsCount + rule)

MUST NOT leak correct answers.

3.3 Save progress (optional but recommended)

POST /api/student/exam-runs/{run_id}/save

saves partial answers + partial canvas

Use optimistic locking.

3.4 Submit

POST /api/student/exam-runs/{run_id}/submit
Body contains:

answers: array of {question_no, selected_option_id?, text_answer?, canvas_data?}
Server will:

Validate time window

Validate composition

Evaluate auto-gradable:

MCQ: compare selectedOptionId to correct option id

OPEN_SINGLE: apply rule matching

For SITUATION: set pending manual grading

Store everything

Lock attempt status=submitted
Return:

status summary: auto_score, pending_manual boolean, message in Azerbaijani

3.5 Student results

GET /api/student/exam-attempts/{attempt_id}/result
Rules:

If not published → return minimal: “Gözləmədə” + auto_score maybe hidden (teacher can configure). Default: show only “submitted, awaiting grading”.

If published → return final score + breakdown.

4) Backend — Teacher grading endpoints
4.1 Live submissions view

GET /api/teacher/exam-runs/{run_id}/submissions?group_id=&status=
Return:

students list with submitted_at, auto_score, pending_manual, final_score, status

4.2 Attempt detail for grading

GET /api/teacher/exam-attempts/{attempt_id}
Return:

answers with question_no, type, student answer, correctness for auto, canvas URLs

computed max score

grading UI needed info

4.3 Grade manual

POST /api/teacher/exam-attempts/{attempt_id}/grade
Body:

per question manual_points override (especially SITUATION)

optional adjustment for MCQ/OPEN (small +/-) but enforce limits
Server:

compute final_points each question = clamp(auto_points + manual_adjust, 0..question_max)

compute final_score = sum(final_points)

status graded
Return updated attempt.

4.4 Publish results

POST /api/teacher/exam-runs/{run_id}/publish

Marks all graded attempts as published (or only selected).

Student/parent can see final results after publish.

4.5 Reset a single student attempt (must preserve history)

Teacher can “Restart student attempt”:
POST /api/teacher/exam-runs/{run_id}/reset-student

Creates new attempt, old attempt stays archived/history.

Student can retake.

Prevent abuse: log action.

5) Frontend — Student exam UI (Google Forms style)

Create/upgrade /student/exams UX:

5.1 Exams list

Show:

exam title

remaining time countdown (ends_at)

button “Başla”

5.2 Exam runner page

/student/exams/run/[runId]
Layout:

Top bar: title + countdown timer + submit button

Questions vertically (Google Forms style)

MCQ: radio group; show A/B/C/D labels based on current order

OPEN: text input with placeholder

SITUATION:

collapsible “Qaralama sahəsi” per situation question

Canvas component:

pen thickness toggle

clear button

undo optional

autosave every 5s + on blur

mobile support: pointer events

5.3 PDF mode runner

Show PDF viewer on top (or left on desktop), Answer Sheet panel:

One section per question number from JSON key file

For situation: open canvas page

Must be responsive; on mobile PDF is full width with Answer Sheet as bottom sheet.

5.4 Submit behavior

Validate unanswered required fields show warnings

Submit calls backend; on success redirect to result state page:

If pending manual: show “Müəllim yoxlaması gözlənilir”

If auto-only quiz: show score only when published (policy: default require publish)

5.5 Prevent reopening

If attempt submitted:

runner route shows “Bu imtahan artıq təhvil verilib” + link to results page (if published) else waiting page.

6) Parent UI

Parent can only see:

List of children

Published exam results per child

Add page /parent/exams or integrate into dashboard:

For each child:

list results: exam title, date, final_score, max_score, status

No access to questions, answers, or PDF content.

7) Teacher UI — Submissions dashboard

In /teacher/tests:

Under each active run:

show group name

submitted count / total students

button “Bax / Yoxla”
Inside submissions view:

table: student, submitted_at, auto_score, pending_manual, final_score, status

clicking opens grading view
Grading view:

shows all answers

for SITUATION: show canvas images + dropdown with ladder values

show computed final_score and “Təsdiqlə” button

“Nəticələri dərc et” to publish

8) Edge cases and correctness

Time window: if timer ended, auto-submit (optional). Minimal: block submit after end but allow teacher to extend.

Concurrency: prevent double submit.

Security: enforce role permissions strictly:

student can access only own attempts

parent can access only their children

Performance:

questions list + options should be cached on start

avoid refetch loops

Keep Azerbaijani UI text; keep API English keys ok.

9) Implementation steps order (follow exactly)

Add/confirm models: ExamRun, ExamAttempt, ExamAnswer, SituationCanvas

Migrate

Implement endpoints for student start/submit and teacher grading/publish

Build student exam runner UI (QuestionBank/JSON)

Add PDF mode runner UI (viewer + answer sheet)

Add parent published results UI

Add teacher submissions/grading UI

Smoke test with seed data:

create quiz and exam runs

student submits

teacher grades and publishes

parent sees results

Fix any bugs found during run/build

Return a short report with what changed and how to test.

When finished, run:

backend: python manage.py check, python manage.py migrate, python manage.py runserver

frontend: npm run build, npm run dev

Do not claim done unless you actually ensure the UI pages exist and you can navigate through the full flow.

You are now finalizing the Coding module of BekrinSchool.
Do NOT break exams, attendance, payments, or authentication.
You may refactor for correctness and clarity but keep UI clean and consistent with existing design.

We are implementing a complete competitive-programming style workflow similar to eolymp:

🎯 GOALS

Teacher can create:

Coding Topics

Problems under topics

Test cases (hidden + visible)

Student:

Sees all assigned problems

Can “Run” → executes ONLY first 2 test cases

Can “Submit” → executes ALL test cases

Can submit multiple times

Teacher:

Sees ALL student attempts (even wrong ones)

Sees detailed per-test-case results

Can sort by attempts / last activity / solved count

Parent:

Sees child progress summary (solved / total)

Everything persists in DB (never auto-deletes)

Fix password inconsistency

Fix teacher not seeing attempts

1️⃣ DATABASE — Coding Structure

Ensure correct models exist:

CodingTopic

id

title

description

created_by (teacher)

archived boolean

created_at

CodingProblem

id

topic FK

title

statement (markdown/text)

difficulty (easy/medium/hard)

time_limit_ms

memory_limit_mb

created_by

archived boolean

created_at

CodingTestCase

id

problem FK

input_text

expected_output

is_sample boolean (first 2 visible)

created_at

Rules:

First 2 test cases → is_sample = True

All others → hidden (is_sample=False)

CodingSubmission

id

problem FK

student FK

code text

language (python for now)

verdict (AC / WA / TLE / RE)

passed_count

total_count

execution_time

created_at

CodingSubmissionResult

id

submission FK

test_case FK

input_text (store snapshot)

expected_output

actual_output

status (PASS / FAIL)

execution_time

DO NOT delete submissions. Ever.
If teacher deletes problem → move to archived.

2️⃣ TEACHER — Topic & Problem Management
Add in Teacher UI:

In /teacher/coding:

Add:

Button: “Yeni mövzu yarat”

Button: “Yeni məsələ yarat”

Topic creation modal:

title

description

Problem creation form:

select topic

title

statement

difficulty

time limit

add test cases section:

dynamic add input/output pairs

first 2 automatically marked as sample

show clear preview of input → output

IMPORTANT:
Teacher must see ALL test cases clearly.
Remove “...” truncation.
Show expandable section:

Input

Expected Output

Add editing ability:

Teacher can edit problem

Teacher can edit test cases

Teacher can archive problem

3️⃣ STUDENT — Coding Page

Route: /student/coding

Must show:

Filter by topic

Sort: newest / most solved / unsolved

Show:

problem title

difficulty

solved badge

attempts count

Click problem:

Layout:
Problem statement
Code editor (monaco)
Buttons:
[Run] [Submit]
Output panel
4️⃣ RUN vs SUBMIT Behavior
RUN

Endpoint:
POST /api/student/coding/{problem_id}/run

Logic:

Execute only first 2 sample test cases

Return:

For each sample:
input
expected
actual
PASS/FAIL

Do NOT save as submission in DB

SUBMIT

Endpoint:
POST /api/student/coding/{problem_id}/submit

Logic:

Execute ALL test cases

Create CodingSubmission

Create CodingSubmissionResult per test case

Compute:

passed_count

total_count

verdict:
if all pass → AC
else → WA

Save everything

Return summary

Student can submit unlimited times.

5️⃣ CODE EXECUTION ENGINE

For now:

Only support Python

Use secure execution:

subprocess

time limit

capture stdout

Strip trailing spaces

Normalize newline differences

Protect:

limit execution time

catch runtime errors

return RE if exception

TLE if over time

6️⃣ TEACHER — Monitoring & Full Visibility

Route: /teacher/coding-monitor

Must show:

Filters:

topic

group

student

verdict

last activity (default sort)

Table:
Student | Problem | Attempts | Last Verdict | Last Activity

Click student → open modal:
Show ALL submissions:

submission date

verdict

passed/total

expandable per-test-case results

show input

expected

actual

status

This fixes:

Student attempts visible but teacher cannot see them.

7️⃣ PARENT — Coding Summary

Parent dashboard:

For each child:

Total problems

Solved count

Attempt count

Recent activity list (last 5)

No code visibility.
No test case visibility.

8️⃣ PASSWORD FIX

Problem:
Password changed in admin but login still accepts old one.

Cause:
Likely custom user model mismatch or password not hashed properly.

Fix:

Ensure:

User model uses AbstractUser

Password change uses set_password()

No manual password field overwrite

Override admin save_model:
If password field changed → call set_password()

Also ensure:
Authentication backend is Django default.

Test:

Change password in admin

Old password must fail

New password must work

9️⃣ FIX: Teacher Not Seeing Submissions

Ensure:
Teacher submissions query:

NOT filtering by organization

NOT filtering by E2E user flag

Use:
CodingSubmission.objects.filter(problem__topic__created_by=teacher)

Ensure:
Group-based filtering works via student.groups relation.

🔟 RESPONSIVENESS

Ensure:

Code editor full width on mobile

Output collapsible

Filters in single row (wrap on mobile)

No horizontal scroll breaking layout

11️⃣ ARCHIVE SYSTEM

When teacher deletes:

topic → set archived=True

problem → archived=True

keep submissions intact

Add tab:
Left sidebar:

“Arxiv”

Filter by:

archived topics

archived problems

12️⃣ FINAL VALIDATION STEPS (Cursor must do)

Create topic

Create problem with 5 test cases

Login as student

Run → see only 2 tests

Submit → full test run

Submit wrong code → see fail

Login as teacher → see attempts

Expand and see detailed results

Login as parent → see summary

Change password in admin → verify login logic

Fix any bug encountered.

Return summary of:

DB changes

Endpoints created

UI routes added

What was fixed

You are now performing deep system stabilization and production-level hardening for BekrinSchool.

⚠️ DO NOT remove existing functionality.
⚠️ DO NOT change database schema destructively.
⚠️ DO NOT break exams, coding, attendance, payments, auth.

Your goal is:

Optimize performance

Improve security

Prevent regressions

Fix subtle data sync issues

Prevent API silent failures

Make system stable under load

You must test and adjust incrementally.

🧠 PART 1 — GLOBAL PERFORMANCE OPTIMIZATION
1.1 Query Optimization

Audit all Django ORM queries:

Fix:

N+1 queries

Missing select_related

Missing prefetch_related

Redundant DB calls in loops

For:

Teacher coding monitor

Exam results

Parent dashboard

Group student lists

Submissions history

Apply:

select_related("student", "problem")
prefetch_related("submission_results")


Where needed.

1.2 Pagination Everywhere

Ensure pagination on:

Students list

Coding submissions

Exam results

Teacher monitor

Question bank

Default:
page_size = 20

Never return full dataset.

1.3 React Query Optimization

In frontend:

Set proper:

staleTime: 60 * 1000
gcTime: 5 * 60 * 1000
refetchOnWindowFocus: false


For static data like:

topics

groups

PDFs

Use:
enabled: !!user

To prevent unnecessary calls.

🔐 PART 2 — SECURITY HARDENING
2.1 Authentication

Ensure:

All protected endpoints use IsAuthenticated

Role-based permission classes exist:

IsTeacher

IsStudent

IsParent

No endpoint should rely on frontend role only.

2.2 Coding Execution Sandboxing

Protect:

subprocess timeout

memory limit

disable dangerous builtins

block:

os

sys.exit

file writing

networking

Return safe errors.

2.3 Prevent IDOR (Insecure Direct Object Reference)

Ensure:

Student cannot:

access other student submission

access other student exam result

access teacher endpoints

Parent cannot:

access another parent’s child

Teacher cannot:

see archived data without permission

Always filter by:
request.user

📦 PART 3 — DATA CONSISTENCY LAYER
3.1 Atomic Transactions

Wrap in:

transaction.atomic()


For:

Exam submission

Coding submission

Payment confirmation

Manual grading

So partial saves cannot occur.

3.2 Remove Silent Failures

Add:

Global exception handler in DRF:

Return:

{
success: false,
message: "Clear explanation"
}

Never raw 500 without context.

3.3 Ensure Persistence

Verify:

Submissions remain after logout

PDFs remain after restart

Archived items remain

Manual grading persists

Fix any accidental overwrite.

📊 PART 4 — SCALABILITY PREPARATION
4.1 Indexing

Add DB indexes on:

student_id

problem_id

exam_id

created_at

group_id

Using:

db_index=True

4.2 Avoid Heavy Serialization

In teacher monitor:
Only return summary first.
Detailed test case data load on demand.

Lazy loading pattern.

📱 PART 5 — RESPONSIVENESS HARDENING

Audit all major pages:

Teacher:

coding

tests

monitor

Student:

coding editor

exam canvas

Parent:

dashboard

Fix:

Horizontal scroll issues

Filter overflow

Mobile sidebar glitch

Buttons overlapping

Canvas scaling on small screen

Ensure:

All layouts responsive via flex/grid

No fixed width > screen width

🧪 PART 6 — DEEP SYSTEM TESTING

Simulate:

50 students

10 simultaneous coding submissions

3 exams active

5 teachers logged in

Check:

No crash

No race condition

No missing data

No duplicated submission

No stale exam state

🧬 PART 7 — REGRESSION PROTECTION

After each change:

Login teacher

Login student

Login parent

Create exam

Submit coding

Grade manual

Confirm payment

If any step fails:
Rollback last change and fix properly.

🔄 PART 8 — AUTO HEALTH CHECK

Implement:

Endpoint:

GET /api/system/health

Return:

{
db: ok,
auth: ok,
coding: ok,
exams: ok
}

Used for monitoring.

🧾 FINAL REPORT FORMAT

After finishing, return:

Optimizations applied

Security fixes applied

Indexes added

Queries optimized

Bugs fixed

Performance before/after estimation