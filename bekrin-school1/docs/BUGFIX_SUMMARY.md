# Bug-Fix Summary — BekrinSchool

## CRITICAL FIX: Balance Charge & Notifications (2024-01-XX)

### Problem
- Balances never decrease after marking attendance
- Low-balance notifications do not clear after payment

### Root Cause
- Attendance save endpoint was not properly returning charge details
- Frontend was not invalidating queries correctly
- Tests were missing for idempotency

### Solution
- Enhanced `finalize_lesson_and_charge()` to return detailed charge info
- Added proof fields to attendance save response
- Created comprehensive tests proving idempotency
- Verified notifications query REAL balance and auto-resolve after payment

### Proof Documentation
See: `docs/BALANCE_CHARGE_PROOF.md`

---

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

### Backend (Balance Charge Fix)
| File | Change |
|------|--------|
| `attendance/services/lesson_finalize.py` | Returns `(lesson_held_created, students_charged, charge_details)` with proof fields |
| `attendance/views/teacher.py` | Response includes `ok`, `date`, `groupId`, `charged_count`, `delivered_marked`, `charged_students` (proof fields) |
| `tests/test_attendance_charge_comprehensive.py` | Comprehensive tests: idempotency, double-save prevention, payment clearing notifications |
| `groups/views/teacher.py` | `teacher_notifications_low_balance_view` queries `balance__lte=Decimal('0')` (REAL balance) |
| `payments/serializers.py` | Already calls `auto_resolve_balance_notifications()` after payment |

### Frontend (Balance Charge Fix)
| File | Change |
|------|--------|
| `app/(teacher)/teacher/attendance/page.tsx` | Logs request details, handles new response format with `charged_count`, shows charge details in toast |
| `lib/teacher.ts` | Updated `saveAttendance` TypeScript interface to match new response format |
| `app/(teacher)/teacher/payments/page.tsx` | Already invalidates notifications query after payment |

### Backend (Previous Fixes)
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

### Balance Charge Endpoints
| Method | Path | Purpose | Response Fields |
|--------|------|---------|-----------------|
| POST | `/api/teacher/attendance/save` | Save attendance + finalize lesson | `ok`, `date`, `groupId`, `charged`, `charged_count`, `delivered_marked`, `charged_students` (proof) |
| GET | `/api/teacher/notifications/low-balance` | Low balance students | `unread_count`, `items` (derived from REAL balance) |

### Previous Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/student/exams/my-results?type=quiz\|exam` | Student results (submitted + unpublished) |
| POST | `/api/teacher/exams/{examId}/reset-student` | Reset student; body: `{ studentId }` |
| GET | `/api/parent/exam-results?studentId=` | Parent results (masked score if unpublished) |

---

## Verification Checklist

### Balance Charge & Notifications (CRITICAL)

#### 1. Attendance Save Decreases Balance
1. Open attendance page, select group and date
2. Mark students as present
3. Click "Saxla" button
4. **Verify:** Browser console shows `[ATTENDANCE_SAVE] Response received:` with `charged: true`, `charged_count > 0`
5. **Verify:** Response includes `charged_students` array with `oldBalance` and `newBalance`
6. **Verify:** Toast shows "✅ Davamiyyət saxlanıldı və dərs yekunlaşdırıldı. X şagirdin balansı yeniləndi."
7. **Verify:** Student list refreshes, balances updated

#### 2. Idempotency (No Double Charge)
1. Save attendance for same date again
2. **Verify:** Response shows `charged: false`, `charged_count: 0`, `charged_students: []`
3. **Verify:** Toast shows "Davamiyyət saxlanıldı. Bu tarix üçün dərs artıq yekunlaşdırılıb..."
4. **Verify:** Student balances unchanged (check DB or UI)

#### 3. Payment Clears Notification
1. Set student balance to 0 (via DB or multiple lesson charges)
2. **Verify:** Student appears in notifications dropdown (bell icon)
3. Create payment for student (amount > 0)
4. **Verify:** Toast shows "✅ Ödəniş əlavə olundu!"
5. **Verify:** Notifications dropdown refreshes, student disappears
6. **Verify:** Student balance > 0 in student list

#### 4. Automated Tests
```bash
cd bekrin-back
.venv\Scripts\activate
python manage.py test tests.test_attendance_charge_comprehensive -v 2
```
**Expected:** All 4 tests pass ✅

#### 5. DB Verification (Manual)
```sql
-- After first attendance save
SELECT id, balance FROM student_profiles WHERE id = <student_id>;
-- Should show decreased balance

SELECT COUNT(*) FROM lessons_held WHERE group_id = <group_id> AND date = '<date>';
-- Should return 1

SELECT COUNT(*) FROM balance_ledger 
WHERE student_profile_id = <student_id> AND group_id = <group_id> AND date = '<date>' AND reason = 'LESSON_CHARGE';
-- Should return 1

-- After second save (same date)
-- All counts should be unchanged
```

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
