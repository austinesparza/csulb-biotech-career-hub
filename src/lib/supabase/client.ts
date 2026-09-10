// Browser client — anon key. Can read public_* views and use explicitly granted
// authentication/RPC capabilities. It cannot insert into base tables directly.
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
