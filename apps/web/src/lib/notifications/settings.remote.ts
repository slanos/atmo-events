import * as v from 'valibot';
import { error } from '@sveltejs/kit';
import { command, getRequestEvent } from '$app/server';
import {
	deleteNotificationEmail,
	ensureNotificationSchema,
	setNotificationEmail
} from './db';

export const saveEmail = command(
	v.object({
		email: v.pipe(v.string(), v.trim(), v.email('Please enter a valid email address.'))
	}),
	async (input) => {
		const { locals, platform } = getRequestEvent();
		if (!locals.did) error(401, 'Not authenticated');
		if (!platform?.env.DB) error(500, 'Database unavailable');

		await ensureNotificationSchema(platform.env.DB);
		await setNotificationEmail(platform.env.DB, locals.did, input.email);
		return { ok: true, email: input.email };
	}
);

export const removeEmail = command(async () => {
	const { locals, platform } = getRequestEvent();
	if (!locals.did) error(401, 'Not authenticated');
	if (!platform?.env.DB) error(500, 'Database unavailable');

	await ensureNotificationSchema(platform.env.DB);
	await deleteNotificationEmail(platform.env.DB, locals.did);
	return { ok: true };
});
