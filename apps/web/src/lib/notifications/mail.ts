// Atmosphere Mail HTTP send client.
//
// POSTs to https://smtp.atmos.email/v1/send with DID + Bearer auth.
// Returns a discriminated result so callers can choose to retry on
// transient failures (429 / 5xx) versus mark-and-move-on for permanent
// failures (other 4xx).

export type SendEmailParams = {
	to: string;
	subject: string;
	html: string;
	text: string;
	/** Optional. If set, "transactional" suppresses List-Unsubscribe headers. */
	category?: string;
};

export type SendEmailEnv = {
	ATMOS_MAIL_API_KEY: string;
	ATMOS_MAIL_DID: string;
	ATMOS_MAIL_FROM: string;
	ATMOS_MAIL_REPLY_TO: string;
};

export type SendEmailResult =
	| {
			ok: true;
			accepted: Array<{ recipient: string; messageId: number }>;
			rejected: Array<{ recipient: string; error: string }>;
	  }
	| {
			ok: false;
			/** When true, caller should leave the cursor in place and retry next tick. */
			retryable: boolean;
			status?: number;
			code?: string;
			error: string;
	  };

const ENDPOINT = 'https://smtp.atmos.email/v1/send';

export async function sendEmail(
	env: SendEmailEnv,
	params: SendEmailParams
): Promise<SendEmailResult> {
	const body = JSON.stringify({
		from: env.ATMOS_MAIL_FROM,
		to: params.to,
		subject: params.subject,
		html: params.html,
		text: params.text,
		replyTo: env.ATMOS_MAIL_REPLY_TO,
		...(params.category ? { category: params.category } : {})
	});

	let response: Response;
	try {
		response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Atmos-DID': env.ATMOS_MAIL_DID,
				Authorization: `Bearer ${env.ATMOS_MAIL_API_KEY}`
			},
			body
		});
	} catch (err) {
		// Network-level failure — treat as retryable.
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[mail] fetch threw: ${message}`);
		return { ok: false, retryable: true, error: message };
	}

	let data: {
		accepted?: Array<{ recipient: string; messageId: number }>;
		rejected?: Array<{ recipient: string; error: string }>;
		error?: string;
		code?: string;
	};
	try {
		data = (await response.json()) as typeof data;
	} catch {
		const text = await response.text().catch(() => '');
		console.error(`[mail] non-JSON response (${response.status}): ${text}`);
		return {
			ok: false,
			retryable: response.status >= 500,
			status: response.status,
			error: text || `HTTP ${response.status}`
		};
	}

	if (!response.ok) {
		const retryable = response.status === 429 || response.status >= 500;
		console.error(
			`[mail] send failed (${response.status} ${data.code ?? ''}): ${data.error ?? 'unknown'}`
		);
		return {
			ok: false,
			retryable,
			status: response.status,
			code: data.code,
			error: data.error ?? `HTTP ${response.status}`
		};
	}

	return {
		ok: true,
		accepted: data.accepted ?? [],
		rejected: data.rejected ?? []
	};
}
