# Bekrin School — Testing Commands & Places to Check

## Quick Start Commands

### Backend

```powershell
cd bekrin-school1\bekrin-back
python manage.py check
python manage.py migrate
python manage.py runserver
```

### Frontend

```powershell
cd bekrin-school1\bekrin-front
npm run build
npm run dev
```

---

## 1. API Health Checks (run when backend is up)

| Command | What to check |
|---------|---------------|
| `curl http://localhost:8000/api/health/` | Returns `{"status":"ok","service":"bekrin-back"}` |
| `curl http://localhost:8000/api/system/health/` | Returns `{"db":"ok","auth":"ok","coding":"ok","exams":"ok"}` |

---

## 2. Auth Flow

| Place | What to check |
|-------|---------------|
| **Login** `/login` | Enter teacher/student/parent credentials → redirects to role dashboard |
| **403 redirect** | Invalid token / expired session → redirects to `/login?reason=unauthorized` |
| **Role switch** | Teacher sees teacher nav; Student sees student nav; Parent sees parent nav |

---

## 3. Exam Access (PROMPT 1/6)

| Place | What to check |
|-------|---------------|
| **Student** `/student/exams` | Start exam → submit → cannot reopen questions; sees "İmtahan yoxlaması söndürülüb" or score only |
| **Parent** `/parent` | Child exam result → sees score only, no questions/canvases |
| **Teacher** `/teacher/tests` → Nəticələr / Yoxlama | Sees full attempt detail, questions, canvases, grading UI |

---

## 4. Archive (STEP 2)

| Place | What to check |
|-------|---------------|
| **Teacher** `/teacher/tests` → Arxiv tab | Sub-tabs: İmtahanlar, Suallar, Sual mövzuları, PDFs, Kod mövzuları, Kod tapşırıqları, **Ödənişlər**, **Qruplar**, **Şagirdlər** |
| **Archive Ödənişlər** | Shows soft-deleted payments; "Bərpa et" restores |
| **Archive Qruplar** | Shows soft-deleted groups; "Bərpa et" restores |
| **Archive Şagirdlər** | Shows soft-deleted students; "Bərpa et" restores |
| **Main Groups** | Deleted groups disappear from main list, appear in Archive |

---

## 5. Coding

| Place | What to check |
|-------|---------------|
| **Teacher** `/teacher/coding` | Create topic, create problem, add test cases, archive problem |
| **Student** `/student/coding` | Filter by topic, Run (2 samples), Submit (all tests), see verdict |
| **Teacher** `/teacher/coding-monitor` | Sees all student attempts, sort by attempts/activity |
| **Parent** | Child progress summary (solved/total) |

---

## 6. Regression Checklist (critical paths)

Run after any backend/frontend change:

1. Login as **teacher** → Panel loads
2. Login as **student** → Panel loads
3. Login as **parent** → Panel loads
4. Create exam (teacher) → Assign groups → Start
5. Take exam (student) → Submit → Cannot reopen
6. Grade attempt (teacher)
7. Submit coding (student)
8. Confirm payment (teacher)

---

## 7. Seeds & E2E Data (optional)

```powershell
cd bekrin-school1\bekrin-back
python manage.py seed_dev
# or
python manage.py seed_e2e
```

Check docs for default credentials (teacher, student, parent).

---

## 8. Linting / Type Check

### Backend
```powershell
cd bekrin-school1\bekrin-back
python -m flake8 . --max-line-length 120
```

### Frontend
```powershell
cd bekrin-school1\bekrin-front
npm run lint
```

---

## 9. Files Changed (Summary)

| Layer | Key paths |
|-------|-----------|
| **Backend** | `config/urls.py` (system health), `groups/views/archive.py`, `groups/views/teacher.py` (group delete + filter), `groups/urls/teacher.py` |
| **Frontend** | `app/(teacher)/teacher/tests/page.tsx` (Archive tabs), `components/Providers.tsx` (React Query), `lib/teacher.ts` (archive APIs) |
| **Exam rules** | `tests/views/exams.py`, `students/views/parent.py`, `app/(student)/student/exams/page.tsx` |

---

## 10. System Health Endpoint (monitoring)

```
GET /api/system/health/
```

Response (all ok):
```json
{"db": "ok", "auth": "ok", "coding": "ok", "exams": "ok"}
```

Use for uptime checks, load balancer health probes, or monitoring dashboards.
