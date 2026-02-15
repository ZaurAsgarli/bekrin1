# Bekrin School — Architecture & Improvements

## Current Structure

```
bekrin-school1/
├── bekrin-back/          # Django REST API + PostgreSQL
│   ├── accounts/         # User, auth
│   ├── core/             # Organization
│   ├── students/         # StudentProfile, ParentChild, views
│   ├── groups/           # Group, GroupStudent, teacher views
│   ├── attendance/
│   ├── payments/
│   ├── coding/
│   ├── tests/
│   └── config/
└── bekrin-front/         # Next.js 14 (App Router)
    ├── app/
    │   ├── (auth)/login/
    │   ├── (teacher)/teacher/
    │   ├── (student)/student/
    │   └── (parent)/parent/
    ├── components/
    └── lib/              # api, auth, role-specific API clients
```

---

## Identified Weaknesses & Solutions

### 1. Backend — Security & Reliability

| Issue | Risk | Solution |
|-------|------|----------|
| No global exception handler | Inconsistent error responses, stack traces in prod | Custom DRF exception handler |
| Teacher views not org-scoped | Data leakage in multi-tenant | Filter querysets by `request.user.organization` |
| JWT in non-httpOnly cookie | XSS can steal token | Consider httpOnly cookie from backend (future) |
| CONN_MAX_AGE=0 | No connection reuse | Set CONN_MAX_AGE in prod for pooling |
| No request logging | Hard audit/debug | Add simple logging middleware |

### 2. Backend — Design

| Issue | Solution |
|-------|----------|
| Teacher URLs in `groups.urls.teacher` | Acceptable; all teacher routes under one include |
| Duplicated org-filter logic | Create `OrganizationScopedMixin` or helper |
| Serializer validation gaps | Add `validate_*` where needed |

### 3. Frontend — UX & Resilience

| Issue | Risk | Solution |
|-------|------|----------|
| No Error Boundary | Unhandled errors crash app | Add error boundary component |
| No 401 handling | Expired token → silent failures | API interceptor redirects to /login |
| No toast/notification | User unsure if action succeeded | Toast context for mutation feedback |
| No sidebar nav | Navigation scattered | Add sidebar with role-based links |
| Root redirects to /login always | Logged-in users sent to login | Check auth, redirect by role |

### 4. Database

| Issue | Solution |
|-------|----------|
| Schema generally solid | Keep as-is |
| Indexes on FKs | Verify via `EXPLAIN ANALYZE` for hot paths |

---

## Implemented Improvements (this session)

### Backend
- [x] Global exception handler for consistent API error format
- [x] Organization-scoped filtering for teacher views
- [x] CONN_MAX_AGE for production settings
- [x] Request logging middleware (optional, env-gated)

### Frontend
- [x] Error Boundary for graceful failure
- [x] 401 interceptor — redirect to login on unauthorized
- [x] Toast notification system
- [x] Sidebar navigation in Layout
- [x] Root page: redirect by role if authenticated

---

## SOLID & Clean Code Notes

- **Single Responsibility**: Each app owns its domain (students, groups, etc.)
- **Open/Closed**: Permissions extend base classes; exception handler extends DRF
- **Liskov**: Role permissions interchangeable via DRF permission system
- **Interface Segregation**: API clients split by role (teacher, student, parent)
- **Dependency Inversion**: Views depend on abstractions (serializers, models)

## Security Checklist

- [x] JWT auth, password validators
- [x] CORS configured
- [x] CSRF trusted origins
- [x] Org-scoped data access for teachers
- [ ] Rate limiting (recommended for auth endpoints)
- [ ] httpOnly cookie for token (future enhancement)
