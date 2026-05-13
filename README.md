# atmo.rsvp

events for the open social web, built on atproto.

https://atmo.rsvp

uses `community.lexicon.calendar.event` and `community.lexicon.calendar.rsvp`.

features:
- event creation
- rsvp to events
- add your events to any ical compatible calendar 
(go to calendar/ when signed in and click "Add to your calendar")
- post your events/rsvps to bluesky or anywhere else with nice open-graph images
- display comments
- show what events your bsky follows are going to
- optional email notifications when someone rsvps to your event
(via [Atmosphere Mail](https://atmospheremail.com); see "email notifications" below)

## development

clone repo

```
pnpm install
```

set remote to false in `wrangler.jsonc` L22:

```
"remote": false
```

optionally if you want all current events to be displayed run this: (will take a few minutes)

```
pnpm backfill
```

start dev server:

```
pnpm run dev
```

## email notifications (optional)

Hosts can opt in to receive an email when someone RSVPs to one of their
events. The notification fires for any RSVP in the AT Proto network —
including RSVPs made from any other client, not just this app — because
the dispatcher reads RSVPs from Contrail's existing Jetstream index.

Email is sent via [Atmosphere Mail](https://atmospheremail.com)'s HTTP
relay (DKIM-signed, cooperative reputation pool for atproto apps).

### enabling for an instance

Set four worker secrets:

```bash
wrangler secret put ATMOS_MAIL_API_KEY   # from atmospheremail.com admin
wrangler secret put ATMOS_MAIL_DID       # the DID enrolled with the key
wrangler secret put ATMOS_MAIL_FROM      # e.g. notifications@yourdomain.com
wrangler secret put ATMOS_MAIL_REPLY_TO  # e.g. noreply@yourdomain.com
```

Without these, the feature is a graceful no-op — users can still save an
email on the settings page, but nothing is dispatched.

### how it works

- D1 tables `notification_emails`, `notifications_sent`, and
  `notifications_cursor` are created idempotently on first request
- The cursor is initialized to `NOW()` at boot, so historical RSVPs in
  Contrail never trigger emails (no backfill)
- After every Contrail ingest tick (1 min), the dispatcher queries
  `rsvp.atmo.rsvp.listRecords` with `createdAtMin > cursor` for each
  opted-in host's events, sends emails, advances the cursor
- Self-RSVPs are skipped; the dispatcher honours a 25s soft budget under
  Cloudflare's 30s cron limit

### known WIP

- The settings page is at `/settings/notifications` and is reachable via
  a small bell icon next to the avatar — discoverability could be better
  (dropdown menu, dedicated settings index page, etc.). Intentional minimal
  surface area for now while the feature is proven out.
- The HTML template is functional but not visually branded — easy to
  customise in `src/lib/notifications/templates.ts`.
- No event-reminder emails (only "someone RSVPed"); that's a follow-up.

## contributing

open for contributions by all :)

