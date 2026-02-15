# Bug-Fix Summary — BekrinSchool

## 3 Qızıl Qayda (endpoint xətası çıxmasın)

1. **Heç bir endpoint path-i dəyişmə** — yalnız əlavə et
2. **Frontend-də bütün API call-lar `lib/` fayllarından keçsin** — hardcode URL olmasın
3. **Backend-də serializer/view dəyişəndə** — response shape geriyə uyğun saxla (field əlavə et, remove etmə)

---

## STEP 0 — Safety Net

### Branch (Git istifadə edəndə)

```bash
git checkout -b fix-final-bugs
```

### Smoke Test Commands

```powershell
# Backend
cd bekrin-school1\bekrin-back
python manage.py check
python manage.py migrate
python manage.py runserver

# Frontend (yeni terminal)
cd bekrin-school1\bekrin-front
npm run dev
# və ya build:
npm run build
```

### Backend Logging

- DRF exception handler: 500 cavablarında heç vaxt stack trace frontendə göndərilməz
- `config.exceptions.custom_exception_handler`: `{ detail, code }` standart format
- Logger `logger.exception()` ilə server loglara yazır; frontend yalnız "An internal error occurred." görür

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `config/exceptions.py` | 500 cavabında stack trace gizlədilir; standart `{ detail, code }` |
| `tests/views/exams.py` | `student_exam_my_results_view`: bütün submitted attempts (excl. RESTARTED); status, is_result_published, type filter; `teacher_exam_reset_student_view`; ghost validation on PATCH status=active; student result masks score when unpublished |
| `tests/serializers.py` | `ExamSerializer`: `is_ghost` field; `_is_ghost_exam()` helper |
| `tests/migrations/0012_fix_ghost_exams.py` | Data migration: active exams missing duration/target → draft |
| `students/views/parent.py` | `parent_exam_results_view`: bütün submitted; score mask (unpublished üçün) |
| `groups/urls/teacher.py` | `exams/<exam_id>/reset-student` route |
| `coding/views/teacher.py` | Defensive null checks (student/task, group_names, per_task_map) |
| `coding/migrations/0010_submission_task_student_created_index.py` | Composite index (task_id, student_id, created_at) |

### Frontend
| File | Change |
|------|--------|
| `app/(student)/student/exams/page.tsx` | Quiz nəticələrim; filter Hamısı/Quiz/İmtahan; "Yoxlanılır" unpublished; submit sonrası invalidate; result detail score null handling |
| `lib/student.ts` | `getMyExamResults(params?)` extended fields |
| `lib/teacher.ts` | `resetStudent(examId, studentId)`; `ExamListItem.is_ghost` |
| `app/(teacher)/teacher/tests/page.tsx` | Aktiv testlər: ghost warning; "Nəticələr" link → grading tab; ghost exams no Stop button |
| `app/(parent)/parent/page.tsx` | İmtahanlar modal: "Yoxlanılır" unpublished; "Bax" yalnız published |
| `lib/parent.ts` | `ChildExamResult` status, is_result_published, optional score |

### Cursor Rule
| File | Change |
|------|--------|
| `.cursor/rules/api-endpoint-rules.mdc` | 3 qızıl qayda (endpoint path dəyişmə, lib üzərindən API, geriyə uyğun response) |

---

## Endpoints (backward compatible)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/student/exams/my-results?type=quiz\|exam` | Student results (submitted + unpublished) |
| POST | `/api/teacher/exams/{examId}/reset-student` | Reset student; body: `{ studentId }` |
| GET | `/api/parent/exam-results?studentId=` | Parent results (masked score if unpublished) |

---

## Verification Checklist

### A) Quiz nəticələrim
1. Teacher: Quiz yarat → qrup təyin et → Start now → 10 dəq
2. Student: Quiz ver → Göndər
3. Student: `/student/exams` → "Quiz nəticələrim" → entry "Yoxlanılır / Nəticə yayımda deyil"
4. Filter: Hamısı / Quiz / İmtahan
5. Teacher: Nəticəni dərc et
6. Student: Bal + "Bax" görünür

### B) Teacher aktiv testlər
1. Teacher: `/teacher/tests` → "Aktiv testlər" tab
2. Bütün status=active imtahanlar görünür
3. Nəticələr / Yoxlama: imtahan seç → cəhdlər → "Yenidən başlat"

### C) Student/Parent dərcədən əvvəl
1. Student submit → "Quiz nəticələrim" → "Yoxlanılır"
2. Parent: İmtahanlar modal → "Yoxlanılır / Nəticə yayımda deyil"
3. "Bax" yalnız dərcdən sonra

### D) Coding monitor
1. Teacher: `/teacher/coding-monitor`
2. Qrup filter; şagirdlərin submissionları görünməlidir

### E) End-to-end
1. Teacher login → quiz yarat → start now
2. Student login → quiz ver → submit
3. Student: Quiz nəticələrim → "Yoxlanılır"
4. Parent: İmtahanlar → "Yoxlanılır"
5. Teacher: Nəticələr → publish
6. Student/Parent: bal görünür
