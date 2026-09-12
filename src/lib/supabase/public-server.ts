import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Anonymous server client for public views and explicitly granted read RPCs. */
export function createPublicServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
