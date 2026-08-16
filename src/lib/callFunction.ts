import { supabase } from './supabase';

const BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Call a Supabase Edge Function with the signed-in user's token.
 *
 * The browser reports every network-level failure as the same bare
 * "Failed to fetch", which hides the actual cause — a missing env var, a
 * function that was never deployed, or being offline. This turns those into
 * messages that say what to check.
 */
export async function callFunction<T = any>(
  name: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!BASE) {
    throw new Error(
      'VITE_SUPABASE_URL is not set for this build. Add it in your host\'s environment variables and redeploy.',
    );
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: ANON ?? '',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // fetch() only throws for network-level problems, never for HTTP errors.
    throw new Error(
      `Could not reach the "${name}" function. Most often this means it hasn't been deployed to Supabase yet ` +
      '(Edge Functions deploy separately from the website). Also check you are online and that ' +
      'VITE_SUPABASE_URL points at the right project.',
    );
  }

  const body = await res.json().catch(() => ({} as any));

  if (res.status === 404) {
    throw new Error(`The "${name}" function is not deployed on this Supabase project yet.`);
  }
  if (!res.ok) {
    throw new Error((body as any).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}
