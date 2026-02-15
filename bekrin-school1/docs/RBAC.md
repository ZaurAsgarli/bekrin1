# Bekrin School – RBAC Implementation

## 1) Backend: Endpoints & Permissions

### Auth Mechanism
- **JWT**: SimpleJWT (rest_framework_simplejwt)
- **User role**: `User.role` (teacher | student | parent)
- **Default**: `IsAuthenticated` for all API views; role-specific views add `IsTeacher`, `IsStudent`, or `IsParent`

### Endpoint Permission Matrix

| Endpoint | Permission | Notes |
|----------|------------|-------|
| **Auth** | | |
| POST /api/auth/login | AllowAny | |
| POST /api/auth/logout | IsAuthenticated | |
| GET /api/auth/me | IsAuthenticated | |
| POST /api/auth/change-password | IsAuthenticated | |
| **Teacher** (all /api/teacher/*) | IsAuthenticated + IsTeacher | |
| /api/teacher/stats | IsTeacher | |
| /api/teacher/students | IsTeacher | |
| /api/teacher/groups | IsTeacher | |
| /api/teacher/payments | IsTeacher | |
| /api/teacher/attendance/* | IsTeacher | |
| /api/teacher/coding/* | IsTeacher | |
| /api/teacher/coding-monitor | IsTeacher | |
| /api/teacher/tests | IsTeacher | |
| /api/teacher/bulk-import/* | IsTeacher | |
| **Users** (all /api/users/*) | IsAuthenticated + IsTeacher | |
| **Student** (all /api/student/*) | IsAuthenticated + IsStudent | |
| /api/student/stats | IsStudent | Own data only (request.user.student_profile) |
| /api/student/attendance | IsStudent | Own data only |
| /api/student/results | IsStudent | Own data only |
| /api/student/coding | IsStudent | Own data only |
| **Parent** (all /api/parent/*) | IsAuthenticated + IsParent | |
| /api/parent/children | IsParent | Own children only (ParentChild) |
| /api/parent/attendance?studentId= | IsParent | ParentChild check for studentId |
| /api/parent/attendance/monthly?studentId= | IsParent | ParentChild check |
| /api/parent/payments?studentId= | IsParent | ParentChild check |
| /api/parent/test-results?studentId= | IsParent | ParentChild check |

### Object-Level Security
- **Student**: All student endpoints use `request.user.student_profile` — no access to other students.
- **Parent**: All parent endpoints check `ParentChild.objects.get(parent=request.user, student__student_profile_id=student_id)` before returning attendance/payments/test-results. Non-child returns 403.

---

## 2) Frontend: Role Source & Route Protection

### Role Source
- **Source of truth**: `GET /api/auth/me` (backend)
- **Hook**: `useAuth()` in `lib/useAuth.ts` — wraps `useMe()` and exposes `{ isAuthenticated, role, userId, fullName, loading }`
- **Note**: Do not trust `userRole` cookie for authorization; it is for display only. The real role comes from `/auth/me`.

### Route Guards
- **Component**: `RoleGuard` in `components/RoleGuard.tsx`
- **Layouts**:
  - `/teacher/*` → `RoleGuard requiredRole="teacher"`
  - `/student/*` → `RoleGuard requiredRole="student"`
  - `/parent/*` → `RoleGuard requiredRole="parent"`
- **Behavior**:
  - Not authenticated → clear cookies, redirect to `/login?reason=unauthorized`
  - Wrong role (e.g. student on /teacher) → clear cookies, redirect to `/login?reason=forbidden&message=...`
  - Correct role → render children

### Menu Filtering
- **Layout** uses `role` from `useMe()` (via `useAuth`)
- `nav = role === "teacher" ? teacherNav : role === "student" ? studentNav : parentNav`
- Each role sees only its own nav items (no shared "Teacher Panel" for non-teachers).

---

## 3) API Error Handling (Fetch Interceptor)

In `lib/api.ts`:
- **401 Unauthorized** → clear cookies, redirect to `/login?reason=unauthorized`
- **403 Forbidden** → clear cookies, redirect to `/login?reason=forbidden&message=...`
- Login page reads `?reason=` and `?message=` and shows the appropriate Azerbaijani message.

---

## 4) Manual Test Plan

| Step | Action | Expected |
|------|--------|----------|
| 1 | Login as **student** | Redirect to /student |
| 2 | Manually type `/teacher` or `/teacher/users` | Redirect to /login with "Bu səhifəyə giriş icazəniz yoxdur. Yenidən daxil olun." |
| 3 | Login as **student**, call `GET /api/teacher/stats` (Postman) | 403 Forbidden |
| 4 | Login as **parent** | Redirect to /parent |
| 5 | Manually type `/teacher/students` | Redirect to /login with forbidden message |
| 6 | Login as **parent**, call `GET /api/parent/attendance?studentId=<non-child-id>` | 403 Forbidden |
| 7 | Login as **teacher** | Redirect to /teacher, see full teacher nav |
| 8 | Login as **teacher**, call `GET /api/teacher/stats` | 200 OK |

---

## 5) No Data Loss Statement

- No destructive commands (DROP, flush, reset) were run.
- No migrations, models, or existing working code were deleted.
- Changes were additive: new `RoleGuard`, `useAuth`, updated `api.ts` 403 handling, login page query handling, layout wrappers.
- All backend permission classes already existed; no views were removed or replaced.
- One parent view ORM fix: `student__student_profile_id` → `student__student_profile__id` (correct Django lookup for ParentChild → StudentProfile).
