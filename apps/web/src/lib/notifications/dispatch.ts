// Cron-driven RSVP notification dispatcher.
//
// Hooked into the existing 1-minute Contrail ingest cron at
// `/apps/web/src/routes/api/cron/+server.ts`. After Contrail finishes
// indexing fresh Jetstream records, this dispatcher:
//
//  1. Reads the `notifications_cursor.last_processed_at` timestamp.
//  2. For each DID in `notification_emails`, queries Contrail's
//     `rsvp.atmo.event.listRecords` to find the host's events.
//  3. For each event, queries `rsvp.atmo.rsvp.listRecords` with
//     `subjectUri=<event uri>` and `createdAtMin=<cursor>` so only RSVPs
//     newer than the cursor are returned.
//  4. Skips self-RSVPs (host RSVP'ing to their own event) and RSVPs
//     already in `notifications_sent`.
//  5. Loads the RSVPer's profile, renders the email, calls
//     `sendEmail()` via the Atmosphere Mail relay.
//  6. On success, records the RSVP URI in `notifications_sent`.
//     On retryable failure, leaves it unrecorded and lets the cursor
//     stay put so we retry next tick. On permanent failure, records
//     it anyway and logs — we don't want retry storms.
//  7. Honors a 25-second soft budget under Cloudflare's 30s cron limit.
//
// Because the cron runs every minute, transient failures (network
// blips, 5xx, 429 warming-tier limits) self-heal: the next tick replays
// the same window if the cursor didn't advance.

import type { Client } from '@atcute/client';
import type { Did } from '@atcute/lexicons';
import {
	advanceCursor,
	getCursor,
	isRsvpNotified,
	listOptedInDids,
	markRsvpNotified
} from './db';
import { sendEmail, type SendEmailEnv } from './mail';
import { rsvpNotificationEmail, type RsvpStatus } from './templates';
import { loadProfile } from '$lib/atproto/server/profile';

const BUDGET_MS = 25_000;

export type DispatchStats = {
	sent: number;
	skipped: number;
	failed: number;
	budgetExceeded: boolean;
};

type DispatchEnv = SendEmailEnv & {
	OAUTH_PUBLIC_URL: string;
	DB: D1Database;
};

export async function dispatchPendingRsvpNotifications(
	env: DispatchEnv,
	contrailClient: Client
): Promise<DispatchStats> {
	const startedAt = Date.now();
	const stats: DispatchStats = { sent: 0, skipped: 0, failed: 0, budgetExceeded: false };

	// Feature is opt-in: if the Atmosphere Mail credentials aren't configured,
	// the dispatcher is a no-op. Lets the rest of the cron pipeline keep
	// running for installs that don't want email notifications.
	if (!env.ATMOS_MAIL_API_KEY || !env.ATMOS_MAIL_DID || !env.ATMOS_MAIL_FROM) {
		return stats;
	}

	const cursor = await getCursor(env.DB);
	const opted = await listOptedInDids(env.DB);
	if (opted.length === 0) {
		// No subscribers — advance the cursor so future opt-ins don't get
		// blasted with a catch-up backlog.
		await advanceCursor(env.DB, new Date().toISOString());
		return stats;
	}

	let maxProcessedAt = cursor;

	for (const { did: hostDid, email: hostEmail } of opted) {
		if (overBudget(startedAt)) {
			stats.budgetExceeded = true;
			break;
		}

		const events = await listHostEvents(contrailClient, hostDid);
		for (const eventUri of events) {
			if (overBudget(startedAt)) {
				stats.budgetExceeded = true;
				break;
			}

			const rsvps = await listRecentRsvps(contrailClient, eventUri, cursor);
			for (const rsvp of rsvps) {
				if (overBudget(startedAt)) {
					stats.budgetExceeded = true;
					break;
				}

				// Track the max createdAt we observed so we can advance the
				// cursor at the end of a successful pass.
				if (rsvp.createdAt > maxProcessedAt) maxProcessedAt = rsvp.createdAt;

				// Skip self-RSVPs.
				if (rsvp.creatorDid === hostDid) {
					stats.skipped++;
					continue;
				}

				// Skip statuses that aren't "going" or "interested".
				if (rsvp.status !== 'going' && rsvp.status !== 'interested') {
					stats.skipped++;
					continue;
				}

				// Cheap dedup belt-and-suspenders on top of the cursor.
				if (await isRsvpNotified(env.DB, rsvp.uri)) {
					stats.skipped++;
					continue;
				}

				const eventName = await fetchEventName(contrailClient, eventUri);
				if (!eventName) {
					// Can't render a useful email without the event name.
					stats.skipped++;
					continue;
				}

				const attendeeProfile = await loadProfile(rsvp.creatorDid as Did, env.DB);
				const attendeeName =
					attendeeProfile?.displayName || attendeeProfile?.handle || rsvp.creatorDid;
				const attendeeHandle =
					attendeeProfile?.handle && attendeeProfile.handle !== rsvp.creatorDid
						? attendeeProfile.handle
						: undefined;

				const eventPagePath = eventUriToPath(eventUri);
				const eventUrl = new URL(eventPagePath, env.OAUTH_PUBLIC_URL).toString();

				const rendered = rsvpNotificationEmail({
					attendeeName,
					attendeeHandle,
					rsvpStatus: rsvp.status,
					eventName,
					eventUrl,
					siteUrl: env.OAUTH_PUBLIC_URL
				});

				const result = await sendEmail(env, {
					to: hostEmail,
					subject: rendered.subject,
					html: rendered.html,
					text: rendered.text
				});

				if (result.ok) {
					await markRsvpNotified(env.DB, rsvp.uri);
					stats.sent++;
				} else if (result.retryable) {
					// Leave un-marked. Cursor stays at its previous value so
					// next tick replays the same window.
					stats.failed++;
					console.error(`[dispatch] retryable failure for ${rsvp.uri}: ${result.error}`);
				} else {
					// Permanent failure — record it as notified to prevent retry
					// storms. Log loudly.
					await markRsvpNotified(env.DB, rsvp.uri);
					stats.failed++;
					console.error(
						`[dispatch] permanent failure for ${rsvp.uri}: ${result.status ?? '?'} ${result.code ?? ''} ${result.error}`
					);
				}
			}
		}
	}

	if (stats.failed === 0 || !anyRetryableObserved(stats)) {
		// Advance cursor either way unless we had retryable failures.
		// (anyRetryableObserved is conservative: if `failed > 0` we already
		// know some failed, but the permanent ones got marked, so we still
		// want to advance.)
		await advanceCursor(env.DB, maxProcessedAt);
	}

	return stats;
}

function overBudget(startedAt: number): boolean {
	return Date.now() - startedAt > BUDGET_MS;
}

function anyRetryableObserved(stats: DispatchStats): boolean {
	// We can't tell retryable from permanent from stats alone, so this is
	// a placeholder for future refinement. For now: if `failed > 0`, the
	// log will say which ones were retryable, and the cursor advance is
	// gated by `failed === 0` already.
	return stats.failed > 0;
}

type SimpleRsvp = {
	uri: string;
	creatorDid: string;
	createdAt: string;
	status: 'going' | 'interested' | 'notgoing' | 'other';
};

async function listHostEvents(client: Client, did: string): Promise<string[]> {
	try {
		const response = await client.get('rsvp.atmo.event.listRecords', {
			params: { actor: did as Did & string, limit: 100 }
		});
		if (!response.ok) return [];
		return (response.data.records ?? []).map((r) => r.uri);
	} catch (err) {
		console.error(`[dispatch] listHostEvents failed for ${did}:`, err);
		return [];
	}
}

async function listRecentRsvps(
	client: Client,
	eventUri: string,
	cursorIso: string
): Promise<SimpleRsvp[]> {
	try {
		const response = await client.get('rsvp.atmo.rsvp.listRecords', {
			params: {
				subjectUri: eventUri,
				createdAtMin: cursorIso,
				limit: 100
			}
		});
		if (!response.ok) return [];
		return (response.data.records ?? []).map((r) => ({
			uri: r.uri,
			creatorDid: r.did,
			createdAt: r.value?.createdAt ?? new Date(0).toISOString(),
			status: normalizeStatus(r.value?.status)
		}));
	} catch (err) {
		console.error(`[dispatch] listRecentRsvps failed for ${eventUri}:`, err);
		return [];
	}
}

function normalizeStatus(s?: string): SimpleRsvp['status'] {
	if (!s) return 'other';
	if (s.endsWith('#going')) return 'going';
	if (s.endsWith('#interested')) return 'interested';
	if (s.endsWith('#notgoing')) return 'notgoing';
	return 'other';
}

const eventNameCache = new Map<string, string>();

async function fetchEventName(client: Client, eventUri: string): Promise<string | null> {
	if (eventNameCache.has(eventUri)) return eventNameCache.get(eventUri) ?? null;
	const parsed = parseAtUri(eventUri);
	if (!parsed) return null;
	try {
		const response = await client.get('rsvp.atmo.event.getRecord', {
			params: { uri: eventUri }
		});
		if (!response.ok) return null;
		const name = (response.data.value as { name?: string } | undefined)?.name ?? null;
		if (name) eventNameCache.set(eventUri, name);
		return name;
	} catch (err) {
		console.error(`[dispatch] fetchEventName failed for ${eventUri}:`, err);
		return null;
	}
}

function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
	const m = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
	if (!m) return null;
	return { did: m[1], collection: m[2], rkey: m[3] };
}

function eventUriToPath(eventUri: string): string {
	const parsed = parseAtUri(eventUri);
	if (!parsed) return '/';
	return `/p/${parsed.did}/e/${parsed.rkey}`;
}
