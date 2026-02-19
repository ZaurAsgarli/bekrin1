# Balance Charge Verification Steps

## Quick Verification (5 minutes)

### Step 1: Check Initial State
```sql
-- Pick a student with balance = 100
SELECT id, balance FROM student_profiles WHERE balance = 100.00 LIMIT 1;
-- Note: student_id = X, group_id = Y
```

### Step 2: Save Attendance (First Time)
**Frontend:**
1. Login as teacher
2. Go to Attendance page
3. Select group and date (Monday or Thursday if group schedule is [1,4])
4. Mark students as present
5. Click "Saxla" button

**Browser Console:**
```
[ATTENDANCE_SAVE] Calling API: { url: "/api/teacher/attendance/save", method: "POST", body: {...} }
[ATTENDANCE_SAVE] Response received: { ok: true, charged: true, charged_count: 2, charged_students: [...] }
```

**Expected Response:**
```json
{
  "ok": true,
  "date": "2024-01-15",
  "groupId": "123",
  "charged": true,
  "charged_count": 2,
  "delivered_marked": true,
  "charged_students": [
    {
      "studentId": "456",
      "oldBalance": 100.0,
      "newBalance": 87.5,
      "chargeAmount": 12.5
    }
  ]
}
```

**DB Verification:**
```sql
-- Balance decreased
SELECT balance FROM student_profiles WHERE id = 456;
-- Expected: 87.50 ✅

-- LessonHeld created
SELECT COUNT(*) FROM lessons_held WHERE group_id=123 AND date='2024-01-15';
-- Expected: 1 ✅

-- BalanceLedger created
SELECT COUNT(*) FROM balance_ledger 
WHERE student_profile_id=456 AND group_id=123 AND date='2024-01-15' AND reason='LESSON_CHARGE';
-- Expected: 1 ✅
```

### Step 3: Save Attendance Again (Same Date) - Idempotency Test
**Frontend:**
1. Same date, same group
2. Change student status (present → absent)
3. Click "Saxla" again

**Expected Response:**
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
-- Expected: 87.50 ✅ (unchanged)

-- LessonHeld count unchanged
SELECT COUNT(*) FROM lessons_held WHERE group_id=123 AND date='2024-01-15';
-- Expected: 1 ✅ (unchanged)

-- BalanceLedger count unchanged
SELECT COUNT(*) FROM balance_ledger 
WHERE student_profile_id=456 AND group_id=123 AND date='2024-01-15' AND reason='LESSON_CHARGE';
-- Expected: 1 ✅ (unchanged)
```

### Step 4: Payment Clears Notification
**Set balance to 0:**
```sql
UPDATE student_profiles SET balance = 0.00 WHERE id = 456;
```

**Check notifications:**
1. Click bell icon in top bar
2. Student should appear in list ✅

**Create payment:**
1. Go to Payments page
2. Select student
3. Amount: 50.00
4. Status: Paid
5. Click "Əlavə et"

**Expected:**
- Toast: "✅ Ödəniş əlavə olundu!"
- Notifications dropdown refreshes
- Student disappears from notifications ✅

**DB Verification:**
```sql
-- Balance increased
SELECT balance FROM student_profiles WHERE id = 456;
-- Expected: 50.00 ✅

-- BalanceLedger entry created
SELECT COUNT(*) FROM balance_ledger 
WHERE student_profile_id=456 AND reason='TOPUP';
-- Expected: >= 1 ✅
```

## Automated Test Verification

```bash
cd bekrin-back
.venv\Scripts\activate
python manage.py test tests.test_attendance_charge_comprehensive -v 2
```

**Expected Output:**
```
test_attendance_save_decreases_balance_exactly_once ... ok
test_attendance_save_same_date_twice_no_double_charge ... ok
test_payment_clears_low_balance_notification ... ok
test_attendance_save_without_monthly_fee_no_charge ... ok

----------------------------------------------------------------------
Ran 4 tests in X.XXXs

OK
```

## Endpoint Details

### POST /api/teacher/attendance/save
**Request:**
```json
{
  "date": "2024-01-15",
  "groupId": "123",
  "records": [
    {"studentId": "456", "status": "present"}
  ],
  "finalize": true
}
```

**Response (First Save):**
```json
{
  "ok": true,
  "date": "2024-01-15",
  "groupId": "123",
  "saved": true,
  "charged": true,
  "charged_count": 1,
  "delivered_marked": true,
  "charged_students": [
    {
      "studentId": "456",
      "oldBalance": 100.0,
      "newBalance": 87.5,
      "chargeAmount": 12.5
    }
  ],
  "message": "Davamiyyət saxlanıldı və dərs yekunlaşdırıldı"
}
```

**Response (Second Save - Same Date):**
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

### GET /api/teacher/notifications/low-balance
**Response:**
```json
{
  "unread_count": 1,
  "items": [
    {
      "studentId": "456",
      "fullName": "Student One",
      "grade": "5A",
      "displayBalanceTeacher": 0.0,
      "realBalance": 0.0,
      "reason": "BALANCE_ZERO",
      "groupId": "123",
      "groupName": "Test Group",
      "lastLessonDate": "2024-01-15"
    }
  ]
}
```

**After Payment (balance > 0):**
```json
{
  "unread_count": 0,
  "items": []
}
```

## Key Database Fields

- **Single Source of Truth:** `StudentProfile.balance` (DecimalField)
- **Idempotency:** `LessonHeld` UNIQUE(group, date)
- **Audit Trail:** `BalanceLedger` UNIQUE(student_profile, group, date, reason)

## Charge Calculation

- `per_lesson = monthly_fee / monthly_lessons_count`
- Example: 100 / 8 = 12.50 AZN per lesson
- Balance decreases by `per_lesson` amount
- Stored as REAL balance (not divided by 4)
