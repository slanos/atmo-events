// D1 helpers for the notification system.
//
// Three tables — all created idempotently on first request via
// `ensureNotificationSchema()`:
//
//  - notification_emails   : DID → opt-in email address
//  - notifications_sent    : record of RSVP URIs we've already dispatched
//                            an email for (belt-and-suspenders dedup on top
//                            of the cursor)
//  - notifications_cursor  : single-row table holding the "last processed at"
//                            timestamp the dispatcher uses to bound the
//                            "what's new" Contrail query
//
// The cursor is initialised to `datetime('now')` the first time the schema
// is created. This is what guarantees no-backfill: RSVP records that exist
// in Contrail's index before the fork is deployed will never trigger emails.

let schemaInitialised = false;

export async function ensureNotificationSchema(db: D1Database): Promise<void> {
	if (schemaInitialised) return;

	await db.batch([
		db.prepare(`
			CREATE TABLE IF NOT EXISTS notification_emails (
				did TEXT PRIMARY KEY,
				email TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`),
		db.prepare(`
			CREATE TABLE IF NOT EXISTS notifications_sent (
				rsvp_uri TEXT PRIMARY KEY,
				sent_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`),
		db.prepare(`
			CREATE TABLE IF NOT EXISTS notifications_cursor (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				last_processed_at TEXT NOT NULL
			)
		`),
		// Seed the cursor at deploy time so we never backfill historical RSVPs.
		db.prepare(`
			INSERT OR IGNORE INTO notifications_cursor (id, last_processed_at)
			VALUES (1, datetime('now'))
		`)
	]);

	schemaInitialised = true;
}

export async function getNotificationEmail(
	db: D1Database,
	did: string
): Promise<string | null> {
	const row = await db
		.prepare('SELECT email FROM notification_emails WHERE did = ?')
		.bind(did)
		.first<{ email: string }>();
	return row?.email ?? null;
}

export async function setNotificationEmail(
	db: D1Database,
	did: string,
	email: string
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO notification_emails (did, email, updated_at)
			 VALUES (?, ?, datetime('now'))
			 ON CONFLICT(did) DO UPDATE SET email = excluded.email, updated_at = datetime('now')`
		)
		.bind(did, email)
		.run();
}

export async function deleteNotificationEmail(db: D1Database, did: string): Promise<void> {
	await db.prepare('DELETE FROM notification_emails WHERE did = ?').bind(did).run();
}

export async function listOptedInDids(db: D1Database): Promise<Array<{ did: string; email: string }>> {
	const result = await db
		.prepare('SELECT did, email FROM notification_emails ORDER BY did')
		.all<{ did: string; email: string }>();
	return result.results ?? [];
}

export async function isRsvpNotified(db: D1Database, rsvpUri: string): Promise<boolean> {
	const row = await db
		.prepare('SELECT 1 AS x FROM notifications_sent WHERE rsvp_uri = ?')
		.bind(rsvpUri)
		.first<{ x: number }>();
	return row !== null;
}

export async function markRsvpNotified(db: D1Database, rsvpUri: string): Promise<void> {
	await db
		.prepare('INSERT OR IGNORE INTO notifications_sent (rsvp_uri) VALUES (?)')
		.bind(rsvpUri)
		.run();
}

export async function getCursor(db: D1Database): Promise<string> {
	const row = await db
		.prepare('SELECT last_processed_at FROM notifications_cursor WHERE id = 1')
		.first<{ last_processed_at: string }>();
	// Should always exist because ensureNotificationSchema seeds it, but
	// fall back to a safe sentinel just in case.
	return row?.last_processed_at ?? new Date().toISOString();
}

export async function advanceCursor(db: D1Database, isoTimestamp: string): Promise<void> {
	await db
		.prepare('UPDATE notifications_cursor SET last_processed_at = ? WHERE id = 1')
		.bind(isoTimestamp)
		.run();
}
