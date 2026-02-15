# Bekrin School — Self-Check Guide (Local Dev)

## Part A — Hydration Warning (Grammarly / Extensions)

**Root cause:** Browser extensions (e.g. Grammarly) inject `data-new-gr-c-s-check-loaded`, `data-gr-ext-installed` into `<html>`/`<body>`. React hydration sees server HTML (no attributes) vs client HTML (with attributes) → mismatch.

**Preferred fix:** Disable Grammarly (and similar extensions) for `localhost` in your browser. The warning will disappear.

**Code mitigation:** `suppressHydrationWarning` is applied only on `<html>` and `<body>` in `app/layout.tsx`. This is safe because:
- Scope is minimal (root elements only).
- Real hydration bugs elsewhere are not hidden.
- Extension pollution is a known React/Next.js limitation.

**Verify:** Disable Grammarly → refresh → warning should be gone. Re-enable → warning returns.

---

## Part B — ERR_CONNECTION_REFUSED (Django API)

**Root cause:** Frontend cannot reach backend. Usually: backend not running, wrong port, or firewall.

### B1) Backend Port

- **Default:** Django `runserver` uses port **8000**.
- **Config:** `lib/constants.ts` → `API_BASE_URL` = `NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api"`.
- **Frontend login URL:** `{API_BASE_URL}/auth/login` → `http://localhost:8000/api/auth/login`.

### B2) Configuration

| File | Variable | Purpose |
|------|----------|---------|
| `bekrin-front/.env.local` | `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api` | Frontend API base |
| `bekrin-back/.env` | `CORS_ALLOWED_ORIGINS=http://localhost:3000` | CORS for Next.js |

Create `bekrin-front/.env.local` from `.env.example` if missing.

### B3) Commands (Run in Order)

**Terminal 1 — Backend:**
```powershell
cd bekrin-back
.venv\Scripts\activate
python manage.py runserver 0.0.0.0:8000
```
Expected: `Starting development server at http://0.0.0.0:8000/`

**Terminal 2 — Frontend:**
```powershell
cd bekrin-front
npm run dev
```
Expected: Console shows `[dev] API base URL: http://localhost:8000/api` (or your custom URL).

**Quick health check:**
```powershell
curl http://localhost:8000/api/health/
```
Expected: `{"status":"ok","service":"bekrin-back"}`

### B4) Diagnostics (Windows)

Check if backend port is in use:
```powershell
netstat -ano | findstr :8000
```
- Listening → backend is running.
- Empty → backend not running.

### B5) CORS / CSRF

- **CORS:** `CORS_ALLOWED_ORIGINS=http://localhost:3000`, `CORS_ALLOW_CREDENTIALS=True`, `Authorization` in allowed headers.
- **JWT:** Token in `Authorization: Bearer <token>` — no CSRF for API.
- **Frontend:** `credentials: "include"` for cookie-based flows; JWT does not rely on cookies for API.

### B6) When Fixed

1. `curl http://localhost:8000/api/health/` → `{"status":"ok","service":"bekrin-back"}`
2. Login page → enter credentials → 200, redirect to dashboard.
3. Browser console: `[dev] API base URL: http://localhost:8000/api`.
