# Group Schedule Days — Smoke Checklist

## Backend

- [ ] **Migration** — `python manage.py migrate groups` runs without error
- [ ] **derive_display_name_from_days** — [1,2,3,4] => "1-4 qrupu", [2,4] => "2,4 qrupu", [1,3,5] => "1,3,5 qrupu"
- [ ] **GET /api/teacher/groups** — Response includes `lesson_days`, `display_name`, `display_name_is_manual`
- [ ] **PATCH /api/teacher/groups/{id}** — Accepts `lesson_days`, `display_name`, `display_name_is_manual`; returns updated group with computed `display_name` when not manual
- [ ] **Validation** — PATCH with `lesson_days: []` returns 400 with "Ən azı bir dərs günü seçilməlidir"
- [ ] **POST /api/teacher/groups** — Accepts `name`, optional `lesson_days`; defaults `lesson_days` to [2,4] when not provided

## Frontend

- [ ] **Group edit modal** — "Dərs günləri" shows 7 chips (B.e, Ç.a, Ç, C.a, C, Ş, B)
- [ ] **Day toggle** — Clicking chips selects/deselects days; at least one required on save
- [ ] **"Adı avtomatik yarat"** — When checked (ON): display_name auto-updates as days change; input disabled
- [ ] **Manual name** — When unchecked (OFF): display_name input enabled; teacher can type
- [ ] **Save** — Sends `lesson_days`, `display_name`, `display_name_is_manual`; list refreshes with new display_name

## Existing Behavior (unchanged)

- [ ] Group list still works; attendance relations work
- [ ] Group card shows `display_name` when available, else `name`
