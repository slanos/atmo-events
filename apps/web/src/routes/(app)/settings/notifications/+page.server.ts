import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ensureNotificationSchema, getNotificationEmail } from '$lib/notifications/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.did) {
		redirect(303, '/');
	}

	if (!platform?.env.DB) {
		// Should never happen in production; protect against dev-mode mishaps.
		return { email: null };
	}

	await ensureNotificationSchema(platform.env.DB);
	const email = await getNotificationEmail(platform.env.DB, locals.did);
	return { email };
};
