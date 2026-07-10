// Server clients. Never import this file from a client component.
//
// CONVENTION (enforced in code review): no admin server action may call
// createServiceClient() before `await requireOfficer()` has succeeded.
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/** Cookie-based client: respects the signed-in officer's session + RLS. */
export async function createServerAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
}

/** Service-role client: bypasses RLS. Use ONLY after requireOfficer() succeeds. */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Throws unless the current session belongs to an active officer. */
export async function requireOfficer() {
  const supabase = await createServerAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data } = await supabase
    .from('officers')
    .select('user_id, display_name')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!data) throw new Error('Not an active officer');
  return { user, officer: data };
}
