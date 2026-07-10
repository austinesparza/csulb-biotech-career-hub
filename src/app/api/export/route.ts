// Export approved records as CSV or JSON for the existing club website.
// Officer-authed. GET /api/export?format=csv|json
// Reads the public view — the export can never contain more than students see.
import { NextResponse, type NextRequest } from 'next/server';
import Papa from 'papaparse';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    await requireOfficer();
  } catch {
    return NextResponse.json({ error: 'Officer access required' }, { status: 403 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from('public_opportunities')
    .select('*')
    .order('relevance_score', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const format = request.nextUrl.searchParams.get('format') ?? 'csv';
  if (format === 'json') return NextResponse.json({ exported_at: new Date().toISOString(), records: data });

  const csv = Papa.unparse(data ?? []);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="career-hub-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
