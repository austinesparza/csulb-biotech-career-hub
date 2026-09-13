-- Backfill controlled scientific lanes for the small set of officer-reviewed
-- opportunities that predate the multidimensional classifier. These rows were
-- still carrying only legacy free-text focus_area values, which meant the
-- canonical discipline filter could miss otherwise valid public opportunities.
--
-- Do not overwrite any row that has already been classified by the current
-- pipeline. Match by stable company/title content rather than generated UUIDs.

update public.opportunities o
set scientific_lanes = case
      when c.name = 'MD Anderson Cancer Center'
       and o.title = 'Research Intern - Thoracic/Head & Neck Medical Oncology'
        then array['Cancer and oncology', 'Diagnostics and clinical data']::text[]
      when c.name = 'CAS'
       and o.title = '2027 Bioinformatics Scientist Summer Intern'
        then array['Bioinformatics and computational biology', 'Biological data science and ML']::text[]
      when c.name = 'Amgen'
       and o.title = 'Grad Intern - Operations Process Development - Summer 2027'
        then array['Bioprocess and manufacturing science']::text[]
      else o.scientific_lanes
    end,
    updated_at = now()
from public.companies c
where c.id = o.company_id
  and cardinality(coalesce(o.scientific_lanes, '{}'::text[])) = 0
  and (
    (c.name = 'MD Anderson Cancer Center'
      and o.title = 'Research Intern - Thoracic/Head & Neck Medical Oncology')
    or (c.name = 'CAS'
      and o.title = '2027 Bioinformatics Scientist Summer Intern')
    or (c.name = 'Amgen'
      and o.title = 'Grad Intern - Operations Process Development - Summer 2027')
  );
