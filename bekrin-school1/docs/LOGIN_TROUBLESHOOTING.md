# Login "Failed to Fetch" Xətası - Problemin Həlli

## Problem
Login zamanı "Failed to fetch" xətası alınır.

## Səbəblər və Həllər

### 1. Backend Server İşləmir
**Yoxlama:**
```bash
# Backend qovluğunda
cd bekrin-back
.venv\Scripts\activate
python manage.py runserver
```

**Gözlənilən nəticə:**
```
Starting development server at http://127.0.0.1:8000/
Quit the server with CTRL-BREAK.
```

**Həll:**
- Backend serveri işə salın: `python manage.py runserver`
- Server `http://localhost:8000` ünvanında işləməlidir

### 2. API URL Yanlışdır
**Yoxlama:**
- Browser console-da: `[dev] API base URL: http://localhost:8000/api`
- `.env.local` faylında: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api`

**Həll:**
- `.env.local` faylı yaradın və düzgün URL-i yazın:
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
```

### 3. CORS Problemi
**Yoxlama:**
- Browser console-da CORS error görünür?
- Backend `env` faylında: `CORS_ALLOWED_ORIGINS=http://localhost:3000`

**Həll:**
- Backend `env` faylında CORS konfiqurasiyasını yoxlayın:
```env
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

### 4. Port Konflikt
**Yoxlama:**
- Port 8000 məşğuldur?
- Başqa bir server 8000 portunda işləyir?

**Həll:**
- Port 8000-i azad edin və ya başqa port istifadə edin:
```bash
# Fərqli portda işə salın
python manage.py runserver 8001
```
Sonra `.env.local`-də URL-i dəyişin:
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api
```

### 5. Network/Firewall Problemi
**Yoxlama:**
- Browser-də `http://localhost:8000/api/health/` açın
- Gözlənilən: `{"status":"ok","service":"bekrin-back"}`

**Həll:**
- Firewall backend serverə icazə verir?
- Antivirus backend serveri bloklayır?

## Adım-adım Yoxlama

1. **Backend Server:**
   ```bash
   cd bekrin-back
   .venv\Scripts\activate
   python manage.py runserver
   ```

2. **Browser-də Test:**
   - `http://localhost:8000/api/health/` açın
   - Gözlənilən: `{"status":"ok","service":"bekrin-back"}`

3. **Frontend Server:**
   ```bash
   cd bekrin-front
   npm run dev
   ```

4. **Browser Console:**
   - F12 açın
   - Console-da `[dev] API base URL:` mesajını yoxlayın
   - Network tab-da login request-ini yoxlayın

5. **Error Mesajı:**
   - İndi daha yaxşı error mesajları göstərilir
   - Error mesajında backend serverin işləyib-işləmədiyi göstərilir

## Yeni Error Mesajları

Login zamanı "Failed to fetch" xətası alınarsa, indi aşağıdakı mesaj görünəcək:

```
Backend server ilə əlaqə qurula bilmədi.

Zəhmət olmasa yoxlayın:
1. Backend server işləyir? (http://localhost:8000)
2. Terminal-də 'python manage.py runserver' işləyir?
3. Browser console-da xəta var?
```

## Tez Həll

1. Backend serveri işə salın: `python manage.py runserver`
2. Browser-də `http://localhost:8000/api/health/` açın və yoxlayın
3. Frontend-də yenidən login edin

## Əlavə Yardım

- Browser console-da tam error mesajını yoxlayın
- Network tab-da request-in status code-unu yoxlayın
- Backend terminal-da error log-larını yoxlayın
