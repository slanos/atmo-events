<script lang="ts">
	import { Input, Button } from '@foxui/core';
	import { saveEmail, removeEmail } from '$lib/notifications/settings.remote';

	let { data } = $props();

	let email = $state(data.email ?? '');
	let savedEmail = $state(data.email);
	let status = $state<{ kind: 'idle' | 'saving' | 'success' | 'error'; message?: string }>({
		kind: 'idle'
	});

	async function handleSave(e: Event) {
		e.preventDefault();
		const trimmed = email.trim();
		if (!trimmed) return;
		status = { kind: 'saving' };
		try {
			const result = await saveEmail({ email: trimmed });
			savedEmail = result.email;
			status = { kind: 'success', message: 'Saved. RSVP notifications enabled.' };
		} catch (err) {
			status = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Could not save your email.'
			};
		}
	}

	async function handleRemove() {
		status = { kind: 'saving' };
		try {
			await removeEmail();
			email = '';
			savedEmail = null;
			status = { kind: 'success', message: 'Email removed. You will no longer receive notifications.' };
		} catch (err) {
			status = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Could not remove your email.'
			};
		}
	}
</script>

<svelte:head>
	<title>Notification Settings</title>
</svelte:head>

<div class="mx-auto max-w-xl px-6 py-8 sm:py-12">
	<h1 class="text-base-900 dark:text-base-50 mb-2 text-2xl font-bold">Email Notifications</h1>
	<p class="text-base-600 dark:text-base-400 mb-6 text-sm leading-relaxed">
		Get an email when someone RSVPs to one of your events. Delivered via
		<a class="underline" href="https://atmospheremail.com" target="_blank" rel="noopener">Atmosphere Mail</a>.
		Notifications fire for any RSVP in the atproto network — including ones made from atmo.rsvp itself or any other client.
	</p>

	<form onsubmit={handleSave} class="flex flex-col gap-3 sm:flex-row">
		<Input
			type="email"
			bind:value={email}
			placeholder="you@example.com"
			class="flex-1"
			autocomplete="email"
			required
		/>
		<Button type="submit" disabled={status.kind === 'saving' || !email.trim()}>
			{savedEmail ? 'Update' : 'Save'}
		</Button>
	</form>

	{#if status.kind === 'success' && status.message}
		<p class="text-base-700 dark:text-base-300 mt-3 text-sm">{status.message}</p>
	{:else if status.kind === 'error' && status.message}
		<p class="mt-3 text-sm text-red-600 dark:text-red-400">{status.message}</p>
	{/if}

	{#if savedEmail}
		<div class="border-base-200 dark:border-base-800 mt-8 border-t pt-6">
			<p class="text-base-500 dark:text-base-400 mb-2 text-xs uppercase tracking-wide">Current</p>
			<p class="text-base-900 dark:text-base-50 mb-4 font-mono text-sm">{savedEmail}</p>
			<Button
				type="button"
				variant="ghost"
				onclick={handleRemove}
				disabled={status.kind === 'saving'}>Remove email and stop notifications</Button
			>
		</div>
	{/if}

	<p class="text-base-500 dark:text-base-500 mt-12 text-xs leading-relaxed">
		Your email is stored only on this server to address notifications to you. It is not written to
		your atproto repo. Remove it any time and your record is deleted immediately.
	</p>
</div>
