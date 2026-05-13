// HTML + plain-text templates for RSVP notification emails.
//
// Keep the HTML structured (real paragraphs, real CTA, real footer) and
// the subject natural-language. Short/sparse "smoke test"-style content
// trips Bayesian spam classifiers; verified during Phase 0 testing.

export type RsvpStatus = 'going' | 'interested';

export type RsvpNotificationParams = {
	attendeeName: string;
	attendeeHandle?: string;
	rsvpStatus: RsvpStatus;
	eventName: string;
	eventUrl: string;
	/** Public URL of the fork — used in the "manage settings" footer link. */
	siteUrl: string;
};

export type RenderedEmail = {
	subject: string;
	html: string;
	text: string;
};

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function statusVerb(status: RsvpStatus): string {
	return status === 'going' ? 'is going to' : 'is interested in';
}

export function rsvpNotificationEmail(params: RsvpNotificationParams): RenderedEmail {
	const { attendeeName, attendeeHandle, rsvpStatus, eventName, eventUrl, siteUrl } = params;
	const verb = statusVerb(rsvpStatus);
	const who = attendeeHandle ? `${attendeeName} (@${attendeeHandle})` : attendeeName;

	const subject = `${attendeeName} ${verb} "${eventName}"`;

	const settingsUrl = new URL('/settings/notifications', siteUrl).toString();

	const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;background:#ffffff">
	<h2 style="margin:0 0 16px;font-size:20px;font-weight:600">New RSVP</h2>
	<p style="font-size:16px;line-height:1.5;margin:0 0 16px">
		<strong>${escapeHtml(who)}</strong> ${verb} your event
		<strong>&ldquo;${escapeHtml(eventName)}&rdquo;</strong>.
	</p>
	<p style="margin:24px 0">
		<a href="${escapeHtml(eventUrl)}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">View event</a>
	</p>
	<p style="font-size:14px;line-height:1.5;color:#555;margin:24px 0 8px">
		See who else is going, leave a comment, or add the event to your calendar from the event page.
	</p>
	<hr style="border:none;border-top:1px solid #eee;margin:32px 0 16px">
	<p style="font-size:12px;line-height:1.5;color:#999;margin:0">
		You are receiving this because you turned on email notifications for your atmo.rsvp events.
		<a href="${escapeHtml(settingsUrl)}" style="color:#777">Manage notification settings</a>.
	</p>
</body>
</html>`;

	const text = [
		`${who} ${verb} your event "${eventName}".`,
		'',
		`View event: ${eventUrl}`,
		'',
		'See who else is going, leave a comment, or add the event to your calendar from the event page.',
		'',
		'---',
		'You are receiving this because you turned on email notifications for your atmo.rsvp events.',
		`Manage notification settings: ${settingsUrl}`
	].join('\n');

	return { subject, html, text };
}
