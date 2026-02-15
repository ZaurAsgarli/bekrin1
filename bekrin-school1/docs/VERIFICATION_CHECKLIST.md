# Bekrin School — Verification Checklist

## Part 1 — Login routing

| Step | Action | Expected |
|------|--------|----------|
| 1 | Login as **teacher** | Redirect to `/teacher` |
| 2 | Login as **student** | Redirect to `/student` |
| 3 | Login as **parent** | Redirect to `/parent` |
| 4 | Login with `mustChangePassword=true` | Redirect to `/change-password` |

**Backend login response:**
```json
{
  "accessToken": "...",
  "user": {
    "email": "...",
    "fullName": "...",
    "role": "teacher|student|parent",
    "mustChangePassword": false
  }
}
```

## Part 2 — Route guards & forbidden access

| Step | Action | Expected |
|------|--------|----------|
| 1 | Login as **student**, manually type `/teacher` | Redirect to login with "Bu səhifəyə giriş icazəniz yoxdur" |
| 2 | Login as **parent**, manually type `/teacher/users` | Redirect to login |
| 3 | Login as **student**, call `GET /api/teacher/stats` (Postman) | 403 Forbidden |
| 4 | Login as **parent**, call `GET /api/teacher/credentials` | 403 Forbidden |
| 5 | Login as **teacher** | See teacher sidebar only (no student/parent items) |

**Backend:** All `/api/teacher/*` use `IsTeacher`; `/api/student/*` use `IsStudent`; `/api/parent/*` use `IsParent`.

## Part 3 — Credentials registry

| Step | Action | Expected |
|------|--------|----------|
| 1 | Bulk import a CSV with students | Credentials saved encrypted in `ImportedCredentialRecord` |
| 2 | Open `/teacher/credentials` | Table shows imported records |
| 3 | Filter by group | Only students in that group |
| 4 | Search by name/email | Filtered results |
| 5 | Click "Şifrəni göstər" (reveal) | Modal with decrypted passwords |
| 6 | Click "CSV Export" | Downloads `credentials_export.csv` |
| 7 | From Students page, click "Hesab məlumatları" | Opens credentials page |
| 8 | From Group detail, click "Bu qrup üçün hesab məlumatları" | Opens credentials filtered by group |

**Environment:** Set `CREDENTIALS_ENCRYPTION_KEY` in `.env` (see `.env.example`). In DEBUG with no key, a dev fallback is used.

## Part 4 — Backend checks

```powershell
cd bekrin-back
.venv\Scripts\activate
python manage.py runserver 0.0.0.0:8000
```

```powershell
# Get token from login, then:
$token = "YOUR_JWT_TOKEN"
curl -H "Authorization: Bearer $token" http://localhost:8000/api/auth/me
# Expected: { "email", "fullName", "role", "mustChangePassword" }

# Student token on teacher endpoint:
curl -H "Authorization: Bearer $STUDENT_TOKEN" http://localhost:8000/api/teacher/stats
# Expected: 403 Forbidden

# Student token on credentials:
curl -H "Authorization: Bearer $STUDENT_TOKEN" http://localhost:8000/api/teacher/credentials
# Expected: 403 Forbidden
```

## Part 5 — No data loss

- No destructive migrations or `flush`/`reset` run
- New model `ImportedCredentialRecord` added; existing models unchanged
- Passwords stored encrypted (Fernet); never plaintext
- Route guards and permissions are additive
