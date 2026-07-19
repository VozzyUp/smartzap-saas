# Faster Voice Note Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove extra post-remux voice validation and the redundant success toast while retaining the WhatsApp-compatible voice conversion.

**Architecture:** The API route will keep FFmpeg remuxing and normalizing OGG/Opus timestamps, then upload and send the returned Meta media ID directly. The client will retain error feedback and sending-state protection, but omit the successful-send toast.

**Tech Stack:** Next.js route handlers, React, Vitest, FFmpeg.

## Global Constraints

- Keep OGG/Opus mono, 48 kHz, VoIP and zero-start timestamps in `remuxToOggOpus`.
- Do not change WhatsApp credentials, the Meta message payload, database schema, or storage behavior.
- Preserve toast errors and the `sending` state.

---

### Task 1: Remove latency-producing voice checks and success toast

**Files:**
- Modify: `app/api/inbox/conversations/[id]/media/route.ts:21-25,132-160,209-240`
- Modify: `app/api/inbox/conversations/[id]/media/route.test.ts:27-31,110-118,260-364`
- Modify: `components/features/inbox/MessageInput.tsx:337-370`
- Test: `app/api/inbox/conversations/[id]/media/route.test.ts`

**Interfaces:**
- Consumes: `remuxToOggOpus(buffer, mime)` returning `{ buffer, mime, remuxed }`.
- Produces: `POST /api/inbox/conversations/:id/media` with `voice=true` uploads and sends without fetching the new Meta media object.

- [ ] **Step 1: Write the failing route regression test**

Update the existing `voice=true remuxa...` test to assert that the Meta download helper is not called after a successful upload:

```ts
expect(downloadMetaMediaMock).not.toHaveBeenCalled()
```

Run: `npm.cmd test -- "app/api/inbox/conversations/[id]/media/route.test.ts"`

Expected: FAIL because the route currently calls `downloadMetaMedia` for every note of voice.

- [ ] **Step 2: Remove the two validation stages**

In `app/api/inbox/conversations/[id]/media/route.ts`:

```ts
import { uploadMediaToMeta } from '@/lib/whatsapp/media'
import { remuxToOggOpus } from '@/lib/audio/voice-remux'
```

Remove the `validateOggOpusVoice` call after remux and remove the complete
`if (isVoice) { await downloadMetaMedia(...) }` block after upload. Keep the
`!r.remuxed` and OGG MIME guard so an unconverted recording is never sent as a
voice note.

In `components/features/inbox/MessageInput.tsx`, remove only:

```ts
toast.success('Nota de voz enviada')
```

- [ ] **Step 3: Run the focused test suite**

Run:

```powershell
npm.cmd test -- lib/audio/voice-remux.test.ts "app/api/inbox/conversations/[id]/media/route.test.ts"
```

Expected: PASS with the route test proving no Meta download occurs and remux tests preserving timestamp normalization.

- [ ] **Step 4: Validate the production build**

Run:

```powershell
npm.cmd run build
git diff --check
```

Expected: Next.js build exits with code 0 and `git diff --check` produces no diff errors.

- [ ] **Step 5: Commit and push**

```powershell
git add -- "app/api/inbox/conversations/[id]/media/route.ts" "app/api/inbox/conversations/[id]/media/route.test.ts" components/features/inbox/MessageInput.tsx
git commit -m "perf: streamline voice note delivery"
git push origin main
```
