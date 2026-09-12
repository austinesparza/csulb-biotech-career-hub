// Company Directory. Reads ONLY the public_companies view.
import { createClient } from '@/lib/supabase/client';
import { CompanyDirectory, type PublicCompany } from './company-directory';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('public_companies')
    .select('*')
    .order('name');
  const companies = (data ?? []) as PublicCompany[];

  return (
    <div className="site-wrap company-page">
      <header className="page-head">
        <h1>Company directory</h1>
        <p className="lede">
          Explore employers by sector, place, and current opportunities. A listing is
          a research lead, not an endorsement.
        </p>
      </header>
      {error && <div className="notice"><span>!</span><span>Could not load companies. Try again later.</span></div>}
      {!error && companies.length === 0 && <p className="company-empty">No companies published yet. Check back soon.</p>}
      {!error && companies.length > 0 && <CompanyDirectory companies={companies} />}
    </div>
  );
}
