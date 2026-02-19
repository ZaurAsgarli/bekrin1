# E2E Validation Checklist

## Prerequisites

1. **Seed E2E data**
   ```bash
   cd bekrin-school1/bekrin-back
   python manage.py seed_e2e
   ```

2. **Start backend**
   ```bash
   python manage.py runserver
   ```

3. **Start frontend**
   ```bash
   cd bekrin-school1/bekrin-front
   npm run dev
   ```

4. **Build verification (run once after code changes)**
   ```bash
   cd bekrin-school1/bekrin-front
   npm run build
   ```

---

## Credentials (after seed_e2e)

| Role   | Email                         | Password   |
|--------|-------------------------------|------------|
| Teacher| teacher_e2e@bekrinschool.az   | teacher123 |
| Student (Group A) | student_e2e_1@bekrinschool.az | student123 |
| Student (Group B) | student_e2e_4@bekrinschool.az | student123 |
| Parent (2 children) | parent_e2e_1@bekrinschool.az | parent123 |

---

## 1. Teacher flows (UI)

| # | Step | Expected | Result |
|---|------|----------|--------|
| T1 | Login as teacher_e2e@bekrinschool.az | Redirect to teacher panel | |
| T2 | Go to "Sual bankı" | See 2 topics: "Riyaziyyat - Mövzu 1", "Riyaziyyat - Mövzu 2" | |
| T3 | Filter/search topics | Search works; topics filter quickly | |
| T4 | Select a topic, see question list | Questions listed per topic | |
| T5 | Edit an existing question (title/text/options) | Save succeeds; changes persist | |
| T6 | PDF library: see 2 PDFs | "Keçən il test 1", "Keçən il test 2" visible | |
| T7 | Click open PDF | Opens without app crash (new tab or viewer) | |
| T8 | Logout, login again | PDF list still shows 2 PDFs | |
| T9 | "Testlər" page: see draft and active exams | Draft: "E2E Draft Quiz"; Active: "E2E Aktiv Quiz", "E2E Aktiv İmtahan" (or clearly labeled) | |
| T10 | Change draft exam status (draft ↔ active) | Status updates; toast/feedback | |
| T11 | Assign group(s) and "İndi başlat" with duration | Groups assigned; exam becomes active with start/end time | |
| T12 | Exam detail: question counts and composition | Shows e.g. "15/15", "12 qapalı + 3 açıq" for quiz; "30/30" for exam | |
| T13 | Exam detail: max_score | 15q => 100, 30q => 150 (editable) | |
| T14 | "Nəticələr / Yoxlama": list attempts by exam/group | Table shows student attempts | |
| T15 | Open attempt: auto score + manual pending for SITUATION | Correct scores; manual inputs for situation questions | |
| T16 | Enter manual points, publish result | Save/publish succeeds | |
| T17 | Revise and republish | Can change manual grades and republish | |

---

## 2. Student flows (UI)

| # | Step | Expected | Result |
|---|------|----------|--------|
| S1 | Login as student_e2e_1@bekrinschool.az (Group A) | Student panel | |
| S2 | Go to "İmtahanlar" | See only Group A active exam(s) in time window (E2E Aktiv Quiz) | |
| S3 | Start active quiz | Questions appear; options shuffled; submission uses option IDs | |
| S4 | Submit answers | Score computed for auto-graded; "Manual yoxlama gözlənilir" if manual parts | |
| S5 | After end_time | Cannot reopen or view questions again | |
| S6 | Result page | Allowed only if published | |
| S7 | Login as student_e2e_4@bekrinschool.az (Group B) | Sees only Group B exam (E2E Aktiv İmtahan, 30q) | |
| S8 | Start 30q exam, submit | Includes SITUATION; manual pending shown | |

---

## 3. Parent flows (UI)

| # | Step | Expected | Result |
|---|------|----------|--------|
| P1 | Login as parent_e2e_1@bekrinschool.az | Parent panel | |
| P2 | Dashboard | Sees children list with stats | |
| P3 | Exam results | For child with published result: shows score | |
| P4 | Manual pending | Shows pending state for unpublished | |
| P5 | Cannot access other students' results | Only own children | |

---

## 4. Coding flows (UI)

| # | Step | Expected | Result |
|---|------|----------|--------|
| C1 | Teacher → "Monitorinq" | Filters in one row (responsive) | |
| C2 | Sorting | Includes "Son aktivliyə görə" | |
| C3 | Ranking | Shows students | |
| C4 | Submissions list | Shows entries | |
| C5 | Click student | Submission history (multiple attempts) | |
| C6 | Student coding page | Tasks by topic; completed vs incomplete | |
| C7 | Student submit | Can submit multiple times | |

---

## 5. Backend verification (optional scripted)

Run with backend and frontend base URLs (e.g. http://127.0.0.1:8000, http://localhost:3000).

```bash
cd bekrin-school1/bekrin-back
python manage.py check
python manage.py migrate
```

- `python manage.py check` → System check identified no issues.
- `python manage.py seed_e2e` → Completes without error.
- After seed: teacher_e2e, 2 groups, 6 students, 3 parents, question bank, 2 PDFs, 3 exams, coding tasks/submissions exist.

---

## 6. Fix log (iterative)

| Issue | Fix |
|-------|-----|
| Layout.tsx duplicate useState | Removed duplicate `const [sidebarOpen, setSidebarOpen]` |
| question-bank updateQuestion payload type | Used Record<string, unknown> and cast for updateQuestion |
| tests/page.tsx examDetail possibly undefined | Added optional chaining `examDetail?.assigned_groups` |
| seed_e2e UnicodeEncodeError on Windows | Replaced Azerbaijani chars in stdout.write with ASCII |
| Student exam list showed all active exams | Filter by student's groups (assignments__group_id__in=group_ids) |

---

## Files changed (E2E + fixes)

### Backend
- `tests/management/__init__.py` (new)
- `tests/management/commands/__init__.py` (new)
- `tests/management/commands/seed_e2e.py` (new)
- `tests/views/exams.py` (student_exams_list_view: filter by student's groups)

### Frontend
- `components/Layout.tsx` (removed duplicate useState)
- `app/(teacher)/teacher/question-bank/page.tsx` (updateQuestion payload type)
- `app/(teacher)/teacher/tests/page.tsx` (examDetail optional chaining)

---

## Final checklist (mark when verified)

- [ ] Backend: `python manage.py check` passes
- [ ] Backend: `python manage.py migrate` (no pending)
- [ ] Backend: `python manage.py seed_e2e` completes
- [ ] Frontend: `npm run build` passes
- [ ] T1–T17: Teacher flows (manual)
- [ ] S1–S8: Student flows (manual)
- [ ] P1–P5: Parent flows (manual)
- [ ] C1–C7: Coding flows (manual)
