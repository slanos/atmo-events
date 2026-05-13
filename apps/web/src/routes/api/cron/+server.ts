import { contrail, ensureInit, getServerClient } from '$lib/contrail/index';
import { dispatchPendingRsvpNotifications } from '$lib/notifications/dispatch';
import { ensureNotificationSchema } from '$lib/notifications/db';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
	const secret = request.headers.get('X-Cron-Secret');
	if (secret !== platform!.env.CRON_SECRET) {
		return new Response('Unauthorized', { status: 401 });
	}

	const env = platform!.env;
	const db = env.DB;

	await ensureInit(db);
	await contrail.ingest({}, db);

	// Email notifications are best-effort — any failure here must not break
	// the ingest pipeline that the rest of the app depends on.
	let dispatchSummary = 'skipped';
	try {
		await ensureNotificationSchema(db);
		const stats = await dispatchPendingRsvpNotifications(env, getServerClient(db));
		dispatchSummary = `sent=${stats.sent} skipped=${stats.skipped} failed=${stats.failed} budget=${stats.budgetExceeded}`;
	} catch (err) {
		console.error('[cron] dispatch failed:', err);
		dispatchSummary = `error: ${err instanceof Error ? err.message : String(err)}`;
	}

	return new Response(`ingested; notifications: ${dispatchSummary}`);
};
