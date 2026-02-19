# Notification System & Lesson Finalize Implementation

## Summary

Implemented a comprehensive notification system for teachers and updated the attendance workflow to support lesson finalization with automatic balance charging.

## Files Changed

### Backend

#### New Models
- `notifications/models.py` - Notification model for teacher alerts
- `students/models.py` - Added BalanceLedger model
- `attendance/models.py` - Added LessonHeld model

#### New Migrations
- `notifications/migrations/0001_initial.py` - Notification model
- `students/migrations/0005_add_balance_ledger.py` - BalanceLedger model
- `attendance/migrations/0004_add_lesson_held.py` - LessonHeld model

#### New Services
- `notifications/services.py` - Notification creation and auto-resolve logic
- `attendance/services/lesson_finalize.py` - Lesson finalization and charging logic

#### Updated Files
- `attendance/views/teacher.py` - Added `finalize` parameter to `attendance_save_view`
- `payments/serializers.py` - Added balance update and auto-resolve hook
- `groups/serializers.py` - Added `monthly_fee` and `monthly_lessons_count` fields
- `config/urls.py` - Added notifications URLs
- `config/settings/base.py` - Added `notifications` to INSTALLED_APPS

#### New Endpoints
- `GET /api/teacher/notifications` - Get active notifications + unread count
- `POST /api/teacher/notifications/{id}/read` - Mark notification as read
- `POST /api/teacher/notifications/{id}/resolve` - Mark notification as resolved
- `POST /api/teacher/notifications/mark-all-read` - Mark all as read

### Frontend

#### New Components
- `components/NotificationsBell.tsx` - Notification bell icon with dropdown

#### Updated Files
- `components/Layout.tsx` - Added NotificationsBell for teachers
- `app/(teacher)/teacher/attendance/page.tsx` - Updated Save button to send `finalize: true`
- `lib/teacher.ts` - Added notification API methods and updated `saveAttendance` to support `finalize`

## Key Features

### 1. Notification System
- **BALANCE_ZERO** notifications created when student balance <= 0
- Auto-resolved when balance increases above 0
- Badge count shows unread notifications
- Dropdown panel with mark as read/resolve actions
- Links to student payment page

### 2. Lesson Finalization
- Teacher clicks "Save" button on attendance page
- Sends `finalize: true` to backend
- Creates `LessonHeld` record (idempotent)
- Charges all active students once per lesson
- Uses `BalanceLedger` for audit trail

### 3. Balance Management
- Single source of truth: `real_balance` in DB
- Teacher view: `real_balance / 4`
- Parent view: `real_balance`
- Lesson charge: `monthly_fee / monthly_lessons_count` (default 8)
- Prevents double charging via unique constraints

## Database Schema

### Notification
- `type` (BALANCE_ZERO, BALANCE_LOW)
- `student` (FK to StudentProfile)
- `group` (FK to Group, nullable)
- `message` (text)
- `is_read` (boolean)
- `is_resolved` (boolean)
- `created_at`, `resolved_at`

### LessonHeld
- `group` (FK to Group)
- `date` (date)
- `created_by` (FK to User, teacher)
- Unique constraint: (group, date)

### BalanceLedger
- `student_profile` (FK to StudentProfile)
- `group` (FK to Group, nullable)
- `date` (date)
- `amount_delta` (Decimal, negative for charges)
- `reason` (LESSON_CHARGE, TOPUP, MANUAL)
- Unique constraint: (student_profile, group, date, reason)

## Testing Checklist

### Manual Smoke Test

1. **Setup**
   - Create teacher, group (schedule: [1,4]), 2 students
   - Set group `monthly_fee=100`, `monthly_lessons_count=8`
   - Set student balances to 100

2. **Test Lesson Finalization**
   - Open attendance page
   - Select group and date (Monday or Thursday)
   - Mark all students present
   - Click "Save" button
   - Verify: balances decrease to 87.5 (100 - 12.5)
   - Verify: teacher view shows 21.875 (87.5 / 4)
   - Click "Save" again: no further decrease (idempotent)

3. **Test Notifications**
   - Simulate 8 lessons (balance hits 0)
   - Verify: notification appears in top bar with badge count
   - Click bell icon: see notification list
   - Mark as read: badge count decreases
   - Resolve notification: disappears from list

4. **Test Auto-Resolve**
   - Student balance is 0 (notification exists)
   - Add payment (top-up) to student
   - Verify: notification auto-resolves
   - Verify: badge count decreases immediately

5. **Test Edge Cases**
   - Save attendance on non-scheduled day: no charge
   - Save attendance without `monthly_fee` set: no charge
   - Multiple teachers save same lesson: only first charge applies

## API Endpoints

### Notifications
- `GET /api/teacher/notifications` - Returns `{ notifications: [], unread_count: number }`
- `POST /api/teacher/notifications/{id}/read` - Mark as read
- `POST /api/teacher/notifications/{id}/resolve` - Mark as resolved
- `POST /api/teacher/notifications/mark-all-read` - Mark all as read

### Attendance
- `POST /api/teacher/attendance/save` - Save attendance with optional `finalize: true`
  - Returns: `{ saved: number, finalized: boolean, students_charged: number, message: string }`

## Migration Steps

1. Run migrations:
   ```bash
   python manage.py makemigrations
   python manage.py migrate
   ```

2. Verify models:
   ```bash
   python manage.py check
   ```

3. Test endpoints:
   - Use Django admin or API client to verify endpoints work

## Notes

- `GroupLessonSession` and `BalanceTransaction` models are kept for backward compatibility but deprecated
- New code uses `LessonHeld` and `BalanceLedger`
- Schedule days format: `[1,4]` means Monday and Thursday (not range 1-4)
- Balance calculations use `Decimal` for precision
- All balance operations are atomic transactions
