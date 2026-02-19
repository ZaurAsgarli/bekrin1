# Multi-Source Exam Builder — Verification Checklist

## Backend

- **Django check**: `cd bekrin-back && python manage.py check` → no issues
- **Migrations**: `python manage.py migrate tests` → applied
- **Tests**: `python manage.py test tests` → all pass (including `tests.test_answer_key`)
- **Seed demo**: `python manage.py seed_demo_tests` → creates quiz (BANK), exam (PDF), quiz (JSON), runs, and one attempt

## API Endpoints (do not break existing)

### Teacher

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/teacher/pdfs` | List PDF library (persist; filter q, year, tag) |
| POST | `/api/teacher/pdfs` | Upload PDF (multipart) |
| PATCH | `/api/teacher/pdfs/{id}` | Update / archive-unarchive |
| DELETE | `/api/teacher/pdfs/{id}` | Archive (soft delete) |
| GET | `/api/teacher/exams` | List exams (includes source_type) |
| POST | `/api/teacher/exams` | Create exam; body: title, type, source_type, question_ids? (BANK), pdf_id? (PDF), answer_key_json? (PDF/JSON), json_import? |
| GET | `/api/teacher/exams/{id}` | Detail: source_type, pdf_url, question_counts, runs |
| POST | `/api/teacher/exams/{id}/create-run` | Body: groupId?, studentId?, duration_minutes, start_now? → runId, start_at, end_at |
| GET | `/api/teacher/exams/{id}/runs` | List runs for exam |
| GET | `/api/teacher/runs/{runId}/attempts` | List attempts for run |
| POST | `/api/teacher/runs/{runId}/reset-student` | Body: studentId |
| GET | `/api/teacher/exams/{id}/attempts` | List attempts (existing) |
| GET | `/api/teacher/attempts/{attemptId}` | Attempt detail (answers by question_number for PDF/JSON; canvases by situationIndex) |
| POST | `/api/teacher/attempts/{attemptId}/grade` | Body: manualScores?, per_situation_scores?: [{index, fraction}], publish?, notes? |
| POST | `/api/teacher/attempts/{attemptId}/publish` | Body: publish |
| DELETE | `/api/teacher/exams/{id}` | Archive exam |
| DELETE | `/api/teacher/questions/{id}` | Archive question |
| DELETE | `/api/teacher/pdfs/{id}` | Archive PDF |

### Student

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/student/exams` | Active runs (runId, examId, remainingSeconds, …) |
| POST | `/api/student/runs/{runId}/start` | Create attempt; returns questions (BANK / PDF / JSON), pdfUrl for PDF |
| POST | `/api/student/exams/{examId}/submit` | Body: attemptId, answers (questionId or questionNumber, selectedOptionId or selectedOptionKey, textAnswer) |
| POST | `/api/student/exams/attempts/{attemptId}/canvas` | Body: questionId? or situationIndex?, imageBase64?, strokes? |
| GET | `/api/student/exams/my-results` | My results (incl. PDF/JSON attempts; masked if not published) |

### Parent

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/api/parent/exam-results?studentId=` | Child results (masked if unpublished) |

## Frontend

- **Build**: `cd bekrin-front && npm run build` → success

### Teacher — exact URLs to click

1. **Question Bank + PDF library**  
   - Open: `/teacher/question-bank`  
   - One page: create question + PDF library in same place (tabs or layout).  
   - Filters: topic, kind, search, sort, show archived.  
   - PDF library: list + upload; PDFs persist until archived.

2. **Tests — new exam wizard**  
   - Open: `/teacher/tests`  
   - Tab “Sual bankı” (or active) → “Yeni imtahan”.  
   - Step 1: Type = Quiz or İmtahan.  
   - Step 2: Source = Hazır suallardan (BANK) / PDF yüklə (PDF) / JSON yüklə (JSON).  
   - Step 3: For BANK add questions; for PDF pick PDF + answer key JSON; for JSON paste/upload JSON.  
   - Step 4: Create draft.  
   - Exam detail: source type, pdf link (if any), composition counters (green/orange).  
   - **Runs**: “Yeni run yarat” → select group OR student, duration, “İndi başlat” → run created.  
   - List runs with status and attempt counts.  
   - **Results**: “Nəticələr” → attempts by student; for each attempt: auto score, manual, total; “Publish”; manual grading for situations (dropdown 0, 2/3, 1, 4/3, 2).  
   - Reset student per run: from run attempts, reset student.

### Student — exact URLs to click

1. **Exams list**  
   - Open: `/student/exams`  
   - List shows active runs with remaining time (countdown).  
   - “Başla” → starts by run (POST `/api/student/runs/{runId}/start`).

2. **Exam taking**  
   - After start: Google-forms style — MC (radio), open (textarea), situations (canvas with pen/eraser/undo/clear, autosave).  
   - Timer and “Göndər”.  
   - On submit: “Göndərildi. Yoxlanılır” → redirect to results list.

3. **My results**  
   - Same page or “Nəticələrim”: shows “Yoxlanılır / Nəticə yayımda deyil” until published; after publish shows score.

### Parent — exact URLs to click

1. **Exam results**  
   - Open: `/parent` (or child dashboard).  
   - Select child → exam results.  
   - Unpublished: masked score / “Yoxlanılır”.  
   - Published: full score and breakdown.

## Composition rules

- **Quiz**: 15 total = 12 closed + 3 open (no situations).  
- **Exam**: 30 total = 22 closed + 5 open + 3 situations.  
- **Scoring**: Quiz max 100; Exam max 150; situation weight 2×.  
- **Order**: closed → open → situations.  
- **MC options**: Shuffled per attempt; labels (A,B,C,D) stay correct after shuffle.

## No 500s

- All new endpoints return 400/404 with messages on error; no unhandled 500.
