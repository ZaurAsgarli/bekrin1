# Balance Charge & Notification Fix - Proof Documentation

## PART 0 - Proof Fields & Tests

### 1. Attendance Save Endpoint Response (Proof Fields)

**Endpoint:** `POST /api/teacher/attendance/save`

**Request:**
```json
{
  "date": "2024-01-15",
  "groupId": "123",
  "records": [
    {"studentId": "456", "status": "present"},
    {"studentId": "789", "status": "present"}
  ],
  "finalize": true
}
```

**Response (with proof fields):**
```json
{
  "ok": true,
  "date": "2024-01-15",
  "groupId": "123",
  "saved": true,
  "charged": true,
  "charged_count": 2,
  "delivered_marked": true,
  "charged_students": [
    {
      "studentId": "456",
      "oldBalance": 100.0,
      "newBalance": 87.5,
      "chargeAmount": 12.5
    },
    {
      "studentId": "789",
      "oldBalance": 100.0,
      "newBalance": 87.5,
      "chargeAmount": 12.5
    }
  ],
  "message": "Davamiyyət saxlanıldı və dərs yekunlaşdırıldı"
}
```

**Second Save (Same Date) - Idempotent:**
```json
{
  "ok": true,
  "date": "2024-01-15",
  "groupId": "123",
  "saved": true,
  "charged": false,
  "charged_count": 0,
  "delivered_marked": false,
  "charged_students": [],
  "message": "Davamiyyət saxlanıldı"
}
```

### 2. Database Evidence

**Single Source of Truth:** `StudentProfile.balance` (DecimalField)

**Idempotency Models:**
- `LessonHeld`: `UNIQUE(group, date)` - ensures lesson finalized once
- `BalanceLedger`: `UNIQUE(student_profile, group, date, reason)` - prevents duplicate charges

**Example DB State After First Save:**
```sql
-- LessonHeld
SELECT * FROM lessons_held WHERE group_id=123 AND date='2024-01-15';
-- Returns 1 row

-- BalanceLedger
SELECT student_profile_id, amount_delta, date, reason 
FROM balance_ledger 
WHERE group_id=123 AND date='2024-01-15' AND reason='LESSON_CHARGE';
-- Returns 2 rows: -12.50 each

-- StudentProfile
SELECT id, balance FROM student_profiles WHERE id IN (456, 789);
-- Returns: 456 -> 87.50, 789 -> 87.50
```

**After Second Save (Same Date):**
```sql
-- LessonHeld count unchanged
SELECT COUNT(*) FROM lessons_held WHERE group_id=123 AND date='2024-01-15';
-- Returns: 1 (unchanged)

-- BalanceLedger count unchanged
SELECT COUNT(*) FROM balance_ledger 
WHERE group_id=123 AND date='2024-01-15' AND reason='LESSON_CHARGE';
-- Returns: 2 (unchanged)

-- StudentProfile balances unchanged
SELECT id, balance FROM student_profiles WHERE id IN (456, 789);
-- Returns: 456 -> 87.50, 789 -> 87.50 (unchanged)
```

### 3. Automated Tests

**Test File:** `tests/test_attendance_charge_comprehensive.py`

**Test Coverage:**
1. ✅ `test_attendance_save_decreases_balance_exactly_once`
   - Creates group with monthly_fee=100, lessons=8
   - Saves attendance with finalize=true
   - Verifies balance decreases from 100.0 to 87.5 (100 - 12.5)
   - Verifies LessonHeld created
   - Verifies BalanceLedger entries created
   - Verifies response contains proof fields

2. ✅ `test_attendance_save_same_date_twice_no_double_charge`
   - Saves attendance twice for same date
   - Verifies second save: charged=false, charged_count=0
   - Verifies balance unchanged
   - Verifies only 1 LessonHeld exists
   - Verifies only 1 BalanceLedger entry per student

3. ✅ `test_payment_clears_low_balance_notification`
   - Sets student balance to 0
   - Verifies student appears in notifications
   - Creates payment to raise balance above 0
   - Verifies student disappears from notifications

4. ✅ `test_attendance_save_without_monthly_fee_no_charge`
   - Group with monthly_fee=None
   - Verifies no charge occurs

**Run Tests:**
```bash
cd bekrin-back
.venv\Scripts\activate
python manage.py test tests.test_attendance_charge_comprehensive -v 2
```

## PART 1 - Frontend -> Backend Flow

### Frontend Code Location
- **File:** `app/(teacher)/teacher/attendance/page.tsx`
- **Function:** `handleSave()` → `saveMutation.mutate()`

### Request Flow
1. User clicks "Saxla" button
2. `handleSave()` called
3. `saveMutation.mutate()` called with:
   ```typescript
   {
     date: "2024-01-15",
     groupId: "123",
     records: [{studentId: "456", status: "present"}, ...],
     finalize: true
   }
   ```
4. Console logs:
   ```
   [ATTENDANCE_SAVE] Calling API: { url: "/api/teacher/attendance/save", method: "POST", body: {...} }
   ```

### Backend Code Location
- **File:** `attendance/views/teacher.py`
- **Function:** `attendance_save_view()`
- **URL Pattern:** `POST /api/teacher/attendance/save`

### Backend Processing
1. Validates date and groupId
2. Saves attendance records
3. If `finalize=true`, calls `finalize_lesson_and_charge()`
4. Returns response with proof fields

## PART 2 - Backend Implementation

### Single Source of Truth
- **Field:** `StudentProfile.balance` (DecimalField)
- **Location:** `students/models.py`
- **No other balance fields exist** - this is the single source

### Idempotency Models

**LessonHeld:**
- **Model:** `attendance/models.py`
- **Unique Constraint:** `UNIQUE(group, date)`
- **Purpose:** Ensures lesson finalized once per group+date

**BalanceLedger:**
- **Model:** `students/models.py`
- **Unique Constraint:** `UNIQUE(student_profile, group, date, reason)`
- **Purpose:** Prevents duplicate charges per student+group+date+reason

### Charge Logic

**Service:** `attendance/services/lesson_finalize.py`

**Function:** `finalize_lesson_and_charge(group, lesson_date, created_by)`

**Process:**
1. Check schedule_days (non-blocking)
2. Calculate `per_lesson = monthly_fee / monthly_lessons_count`
3. Create `LessonHeld` (idempotent - get_or_create)
4. If already exists → return `(False, 0, [])` (no charge)
5. Get active students
6. For each student:
   - Refresh balance from DB
   - Calculate `new_balance = old_balance - per_lesson`
   - Create `BalanceLedger` entry
   - Update `StudentProfile.balance`
7. Bulk update balances
8. Verify updates (refresh_from_db)
9. Check/create notifications
10. Return `(True, count, charge_details)`

**Date Handling:**
- Input: `YYYY-MM-DD` string
- Parsed: `datetime.strptime(date_str[:10], "%Y-%m-%d").date()`
- Stored: `DateField` (no timezone issues)

## PART 3 - Frontend Refresh & Feedback

### Query Invalidation (After Save)
```typescript
queryClient.invalidateQueries({ queryKey: ["teacher", "attendance"] });
queryClient.invalidateQueries({ queryKey: ["teacher", "notifications", "low-balance"] });
queryClient.invalidateQueries({ queryKey: ["teacher", "students"] });
queryClient.invalidateQueries({ queryKey: ["teacher", "stats"] });
```

### Success Toast
- Shows: `"✅ Davamiyyət saxlanıldı və dərs yekunlaşdırıldı. X şagirdin balansı yeniləndi."`
- Includes charge details: `"Balanslar: 100→87.5, 100→87.5"`

### Payment Success (After Payment)
- Invalidates same queries
- Shows: `"✅ Ödəniş əlavə olundu! Student Name - Yeni balans: X AZN"`

## PART 4 - Notifications Clearing

### Notification Source
- **Endpoint:** `GET /api/teacher/notifications/low-balance`
- **Query:** `StudentProfile.objects.filter(balance__lte=Decimal('0'))`
- **Uses REAL balance** (`StudentProfile.balance`)

### Auto-Resolution
- **Function:** `auto_resolve_balance_notifications(student_profile)`
- **Called:** After payment creation (if status='paid')
- **Logic:** If `balance > 0`, mark all `BALANCE_ZERO` notifications as resolved
- **Location:** `notifications/services.py`

### Payment Flow
1. Payment created with `status='paid'`
2. `StudentProfile.balance` updated atomically
3. `BalanceLedger` entry created
4. `auto_resolve_balance_notifications()` called
5. Frontend invalidates notifications query
6. Student disappears from notifications list

## PART 5 - Verification Steps

### Step 1: Initial State
```sql
-- Student balance = 100.00
SELECT id, balance FROM student_profiles WHERE id = 456;
-- Returns: 456, 100.00
```

### Step 2: Save Attendance (First Time)
**Request:**
```bash
POST /api/teacher/attendance/save
{
  "date": "2024-01-15",
  "groupId": "123",
  "records": [{"studentId": "456", "status": "present"}],
  "finalize": true
}
```

**Response:**
```json
{
  "ok": true,
  "charged": true,
  "charged_count": 1,
  "charged_students": [{
    "studentId": "456",
    "oldBalance": 100.0,
    "newBalance": 87.5,
    "chargeAmount": 12.5
  }]
}
```

**DB Verification:**
```sql
-- Balance decreased
SELECT balance FROM student_profiles WHERE id = 456;
-- Returns: 87.50 ✅

-- LessonHeld created
SELECT COUNT(*) FROM lessons_held WHERE group_id=123 AND date='2024-01-15';
-- Returns: 1 ✅

-- BalanceLedger created
SELECT COUNT(*) FROM balance_ledger 
WHERE student_profile_id=456 AND group_id=123 AND date='2024-01-15' AND reason='LESSON_CHARGE';
-- Returns: 1 ✅
```

### Step 3: Save Attendance (Second Time - Same Date)
**Request:** Same as Step 2

**Response:**
```json
{
  "ok": true,
  "charged": false,
  "charged_count": 0,
  "charged_students": []
}
```

**DB Verification:**
```sql
-- Balance unchanged
SELECT balance FROM student_profiles WHERE id = 456;
-- Returns: 87.50 ✅ (unchanged)

-- LessonHeld count unchanged
SELECT COUNT(*) FROM lessons_held WHERE group_id=123 AND date='2024-01-15';
-- Returns: 1 ✅ (unchanged)

-- BalanceLedger count unchanged
SELECT COUNT(*) FROM balance_ledger 
WHERE student_profile_id=456 AND group_id=123 AND date='2024-01-15' AND reason='LESSON_CHARGE';
-- Returns: 1 ✅ (unchanged)
```

### Step 4: Payment Clears Notification
**Set balance to 0:**
```sql
UPDATE student_profiles SET balance = 0.00 WHERE id = 456;
```

**Check notifications:**
```bash
GET /api/teacher/notifications/low-balance
```
**Response:** Student 456 appears in list ✅

**Create payment:**
```bash
POST /api/teacher/payments
{
  "studentId": 456,
  "groupId": 123,
  "amount": 50.00,
  "date": "2024-01-16",
  "method": "cash",
  "status": "paid"
}
```

**DB Verification:**
```sql
-- Balance increased
SELECT balance FROM student_profiles WHERE id = 456;
-- Returns: 50.00 ✅
```

**Check notifications again:**
```bash
GET /api/teacher/notifications/low-balance
```
**Response:** Student 456 NO LONGER appears ✅

## Summary

### Proof Points
1. ✅ **Balance decreases:** Response shows `oldBalance → newBalance`
2. ✅ **Idempotent:** Second save returns `charged=false`, balance unchanged
3. ✅ **DB evidence:** LessonHeld and BalanceLedger enforce idempotency
4. ✅ **Notifications clear:** Student disappears after payment raises balance > 0
5. ✅ **Automated tests:** All scenarios covered in `test_attendance_charge_comprehensive.py`

### Key Files Changed
- `attendance/services/lesson_finalize.py` - Returns charge_details
- `attendance/views/teacher.py` - Returns proof fields in response
- `tests/test_attendance_charge_comprehensive.py` - Comprehensive tests
- `app/(teacher)/teacher/attendance/page.tsx` - Logs request, handles new response format
- `lib/teacher.ts` - Updated TypeScript interface

### Verification Command
```bash
cd bekrin-back
.venv\Scripts\activate
python manage.py test tests.test_attendance_charge_comprehensive -v 2
```

**Expected:** All tests pass ✅
