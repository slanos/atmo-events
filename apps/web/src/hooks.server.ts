import type { Handle } from '@sveltejs/kit';
import { restoreSession } from '$lib/atproto/server/session';
import { ensureNotificationSchema } from '$lib/notifications/db';

export const handle: Handle = async ({ event, resolve }) => {
	const { session, client, did } = await restoreSession(
		event.cookies,
		event.platform?.env
	);

	event.locals.session = session;
	event.locals.client = client;
	event.locals.did = did;

	// Idempotent — the module-level flag inside ensureNotificationSchema()
	// makes subsequent calls a no-op. On first run it seeds the
	// notifications_cursor so we never email about historical RSVPs.
	if (event.platform?.env.DB) {
		await ensureNotificationSchema(event.platform.env.DB);
	}

	return resolve(event);
};
