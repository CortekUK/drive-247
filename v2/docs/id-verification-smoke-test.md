# ID Verification — Smoke Test Playbook

This document walks you through end-to-end testing the ID verification feature with real AWS + OpenAI. Follow top to bottom — each section depends on the previous one being green.

---

## Part 1 — AWS Setup (one-time)

### 1.1 Create an S3 bucket

Name suggestion: `drive247-v2-documents-dev` (or your own).

**Critical settings:**
- **Region:** any — but remember it (you'll put it in `AWS_REGION`). Suggest `us-east-1`.
- **Block Public Access:** ✅ **all four boxes ON** (bucket must be fully private)
- **Versioning:** off (Phase 1; add later if needed)
- **Default encryption:** SSE-S3 (default) is fine. Optional: SSE-KMS with a customer-managed key.

**CORS:** not required for Phase 1. The browser never talks to S3 directly — all uploads go through the backend, and reads use signed URLs that bypass CORS.

### 1.2 Create an IAM user

Name: `drive247-v2-id-verification`.

**Access type:** programmatic (access key + secret).

**Policy — attach this inline:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3DocumentStorage",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::drive247-v2-documents-dev/*"
    },
    {
      "Sid": "RekognitionFaceCompare",
      "Effect": "Allow",
      "Action": [
        "rekognition:CompareFaces"
      ],
      "Resource": "*"
    }
  ]
}
```

Replace the bucket ARN with yours. **Principle of least privilege** — these are the only 4 API actions the backend needs. Don't add `s3:ListBucket`, `s3:*`, or `AdministratorAccess`.

Save the access key ID + secret. You'll paste them into `.env.local`.

### 1.3 Rekognition availability

`rekognition:CompareFaces` is available in most AWS regions. If yours lacks it, switch `AWS_REGION` to one that has it (us-east-1, us-west-2, eu-west-1 all work). Rekognition does **not** require an S3 region match — it can pull source/target images from any region your IAM user can read.

**Cost:** ~$1 per 1,000 face-compare calls. Each verification = 1 call. Budget accordingly.

### 1.4 OpenAI Vision access

You need an OpenAI API key with access to `gpt-4o` (not just gpt-4o-mini — OCR quality matters).

**Cost:** ~$0.01–$0.02 per verification (input: ~2 images at ~0.5MB each + prompt + output). Budget accordingly.

---

## Part 2 — Environment Config

Edit `v2/apps/backend/.env.local`. Add or update:

```
# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=drive247-v2-documents-dev

# OpenAI (if not already set)
OPENAI_API_KEY=sk-...

# Portal base URL — used in the QR code the staff generates.
# MUST be reachable from the phone that will scan the QR.
# Dev on same machine: use your LAN IP, NOT localhost.
# Find it: Windows → `ipconfig`, macOS/Linux → `ifconfig | grep inet`
PORTAL_BASE_URL=http://192.168.1.50:3001
```

**Restart the backend** after editing `.env.local` (it's loaded at boot).

---

## Part 3 — DB & Seed

If you haven't already:

```bash
# From v2/apps/backend
pnpm db:migrate     # applies 0007_romantic_unicorn.sql (ID verification schema)
pnpm db:seed        # creates test tenant + admin user (safe to skip if already seeded)
```

**Enable ID verification for your test tenant.** Easiest way: log into the portal → Settings → ID Verification Settings → toggle "Allow staff to start verifications for customers" → Save.

Or via SQL if you want to be explicit:
```sql
UPDATE tenants SET id_verification_enabled = true WHERE slug = 'test';
```

---

## Part 4 — Part-by-part smoke test

Each section has expected output. If anything fails, **stop and debug** before moving on.

### 4.1 Backend live + routes registered

```bash
# From v2/apps/backend
pnpm start
```

Expect to see route-mapping lines including:

```
Mapped {/api/id-verification, GET} route
Mapped {/api/id-verification/:id, GET} route
Mapped {/api/id-verification/:id/events, GET} route
Mapped {/api/id-verification/sessions, POST} route
Mapped {/api/id-verification/:id/cancel, POST} route
Mapped {/api/id-verification/:id/retry, POST} route
Mapped {/api/id-verification/:id/review, POST} route
Mapped {/api/id-verification/blocks, GET} route
Mapped {/api/id-verification/blocks, POST} route
Mapped {/api/id-verification/blocks/:id, PATCH} route
Mapped {/api/id-verification/blocks/:id, DELETE} route
Mapped {/api/id-verification/settings, GET} route
Mapped {/api/id-verification/settings, PATCH} route
Mapped {/api/public/id-verification/sessions/:token, GET} route
Mapped {/api/public/id-verification/sessions/:token/files, POST} route
Mapped {/api/public/id-verification/sessions/:token/step, POST} route
Mapped {/api/public/id-verification/sessions/:token/submit, POST} route
```

Sanity-check with curl (no auth):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/id-verification
# → 401 (auth required)

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/public/id-verification/sessions/deadbeef
# → 401 (invalid token)
```

### 4.2 Portal frontend + settings page

```bash
# From v2/apps/frontend/portal (separate terminal)
pnpm dev
```

Open `http://{tenant-slug}.localhost:3001` (e.g. `test.localhost:3001`) → log in.

1. Sidebar should show 3 new entries: **ID Verifications**, **ID Verification Settings**, **Blocked Identities**.
2. Go to **ID Verification Settings**:
   - Toggle "enabled" → Save → should succeed.
   - Leave thresholds blank initially (uses platform defaults 90 / 70 / 0.7).
   - Verify the placeholder text shows the defaults.

### 4.3 Create a verification session

1. Navigate to an existing customer's detail page (seed a customer first if none exists).
2. Scroll to the "Identity verification" section.
3. Click **Start ID Verification** → pick a document type → **Generate QR**.
4. Expected: modal shows a QR code, session status shows "Initiated".
5. Click "Copy" on the URL. Verify the URL starts with `PORTAL_BASE_URL` — e.g. `http://192.168.1.50:3001/verify/<token>`.
6. **Do NOT close the modal** — keep polling visible.

### 4.4 Mobile capture (real phone or Chrome device emulation)

**Option A — real phone** (most realistic):
- Connect phone to the SAME Wi-Fi as your dev machine.
- Ensure your firewall allows incoming connections on port 3001 (macOS: System Settings → Network → Firewall → allow Node.js).
- Scan the QR. It should open the `/verify/<token>` page.

**Option B — desktop Chrome + camera**:
- Open the URL in Chrome DevTools device mode (iPhone/Pixel preset).
- Chrome uses your laptop webcam for `getUserMedia`.

**Expected flow:**
1. Page shows tenant name + stepper + "Photo of the FRONT of your driving licence" (or whichever doc type).
2. Live camera view appears. (If it fails: Chrome will prompt for camera permission; mobile Safari too.)
3. Click **Capture photo** → preview appears → **Use this photo** → uploads, step advances to back (or selfie for passport).
4. Repeat for back + selfie.
5. After selfie confirm: step becomes "Verifying your ID..." — this is `processing`.

**In parallel:** the staff QR modal should pick up the status transitions via polling (watch the badge).

### 4.5 Verify the backend pipeline ran

Tail the backend logs while a verification is processing. You should see:

```
[IdVerificationProcessingService] ... (no error)
# In the DB, the verification row should now have:
#   status: approved | rejected | review_required
#   ocr_confidence: 0.x (some number)
#   face_match_score: xx.x (some percentage)
#   ocr_raw, face_match_raw: populated JSONB
```

Quick SQL check:

```sql
SELECT id, status, ocr_confidence, face_match_score, decided_at, rejection_reason
FROM id_verifications
ORDER BY created_at DESC
LIMIT 1;
```

### 4.6 Verify S3 got the files

```bash
aws s3 ls s3://drive247-v2-documents-dev/tenants/<your-tenant-uuid>/id-verification/ --recursive
```

Expect 2–3 objects per verification (`document_front.jpg`, optional `document_back.jpg`, `selfie.jpg`). If the folder is empty but the verification record exists with S3 keys — check IAM permissions.

### 4.7 Verify the staff can view

1. From the portal, click through to `/verifications/<id>` (or find it in the list).
2. You should see:
   - Status badge matching what the backend decided
   - Three images rendered (signed URLs)
   - OCR fields populated (name, DOB, doc number, etc.)
   - Face match panel with score + threshold bar
   - Event log with ~6–8 entries: `session.created`, `session.token_validated`, `capture.file_uploaded` (×3), `capture.submitted`, `processing.started`, `processing.ocr_completed`, `processing.face_match_completed`, `decision.*`

3. If status is `review_required`:
   - Check **Reminders** (if wired in sidebar yet) — should contain `ID_VERIFICATION_REVIEW_REQUIRED` rule.
   - Click **Approve** or **Reject** → enter a reason → submit → status flips; reminder auto-resolves.

### 4.8 Retry flow

Still on detail page (on a non-`initiated` verification):

1. Click **Request retry** → enter reason → **Generate new QR**.
2. Verify:
   - New QR modal appears with a different token.
   - Old S3 files are deleted from the bucket (`aws s3 ls` should show them gone).
   - DB: OCR / face match fields nulled; status back to `initiated`.
3. Complete the flow again on the phone with a better photo.

### 4.9 Blocked identity flow

1. Go to **Blocked Identities** → **Add block**.
2. Pick "Driving License" and enter the document number from the verification you just completed — exactly as OCR extracted it, case-insensitive (e.g. `D1234567`).
3. Save.
4. Go back to customer → start a NEW verification → complete capture with the same ID document.
5. Expected: decision auto-rejects with reason "Identifier matches an active block on this tenant"; event log contains `processing.block_matched`.

### 4.10 Cross-tenant isolation (critical)

**This is a non-negotiable verification before shipping.** In a second browser (or incognito):

1. Seed / log into a different tenant.
2. Confirm you **cannot** see verifications, blocks, or settings from the first tenant.
3. Try pasting a verification UUID from tenant A into tenant B's URL bar (`/verifications/<uuid-from-a>`) — should 404.
4. Try the same for `/id-verification/blocks/<block-id-from-a>` via curl — should 404.

---

## Part 5 — What to watch for

### Signals of a healthy pipeline
- OCR confidence ≥ 0.85 on clear, well-lit photos
- Face match ≥ 90 for matching people (normal lighting)
- Event log fires in expected order (see §4.7)
- Reminders auto-emit on `review_required` and auto-resolve on terminal states

### Known rough edges
- `getUserMedia` requires **HTTPS in production.** Localhost is exempt; LAN-IP dev works because browsers treat local IPs leniently, but some mobile Safari versions are strict. If camera fails on mobile Safari, document this as "need TLS in prod" — use `ngrok` or a dev TLS cert for hands-on testing.
- OpenAI Vision occasionally returns `confidence: null` on small/dark images. Expected — pipeline treats as `review_required` correctly.
- Rekognition returns 400 "No face in source" when the document photo has no face detectable (e.g. close-up of only the license number). The backend maps this to `review_required` rather than crashing.

### Cost watch
- Every completed verification = 1 OpenAI Vision call + 1 Rekognition call ≈ $0.02 total
- Each retry adds another $0.02
- For 100 test verifications budget ~$2

---

## Part 6 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| QR link shows `localhost` | `PORTAL_BASE_URL` not set | Restart backend after editing `.env.local` |
| Phone can't open QR | Wrong LAN IP / firewall | Use `ipconfig`; allow port 3001 through firewall |
| Upload 500s | AWS IAM missing `s3:PutObject` | Check IAM policy; restart backend |
| Upload 400 "Unsupported file type" | HEIC from iPhone | Upload fallback accepts only JPEG/PNG/WEBP; ask phone to "save as JPEG" or use the camera-capture path which always emits JPEG |
| Processing hangs in `processing` state forever | Background `process()` crashed silently | Check backend logs; catch-all should mark `review_required` — if it doesn't, the DB transaction itself is failing |
| `decision.auto_rejected` with no reason | Block match with no extracted number | Expected when OCR fails to read doc number — status should be `review_required` not `rejected`. If it's rejected, check the decision util priority: block > OCR |
| Face match always 0 | Source image has no face (e.g. ID with covered photo) | Expected — Rekognition logs "no face detected in source"; status becomes `review_required` |
| Camera doesn't start on phone | HTTPS required, or permissions denied | Use file-upload fallback; for dev use LAN IP or ngrok |

---

## Part 7 — What's explicitly NOT tested here

- Load / concurrency (multiple simultaneous verifications)
- Token hash-collision (infeasible at 256-bit entropy)
- Multi-instance backend (token cache is in-process)
- GDPR purge (no retention policy in Phase 1 — see main plan's "To Revisit")
- Email / SMS notifications (not wired until notification module lands)

These are Phase 2 concerns and should be revisited before production.
