import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const seedPath = resolve(root, 'supabase/seed_historical.sql');
const outputPath = resolve(root, 'data/historical-opportunities.json');

function parseSqlArguments(input) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted && character === "'" && input[index + 1] === "'") {
      value += "'";
      index += 1;
    } else if (character === "'") {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim() === 'null' ? null : value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim() === 'null' ? null : value.trim());
  return values;
}

const displayNames = {
  '3m': '3M',
  'abbvie': 'AbbVie',
  'amgen': 'Amgen',
  'arcus biosciences': 'Arcus Biosciences',
  'astrazeneca': 'AstraZeneca',
  'biomarin': 'BioMarin',
  'bristol meyers squibb': 'Bristol Myers Squibb',
  'cedars sinai': 'Cedars-Sinai',
  'cytokinetics': 'Cytokinetics',
  'decibio': 'DeciBio',
  'enthalpy analytical': 'Enthalpy Analytical',
  'fujifilm diosynth': 'Fujifilm Diosynth Biotechnologies',
  'ge healthcare': 'GE HealthCare',
  'genentech': 'Genentech',
  'henkel': 'Henkel',
  'johnson and johnson': 'Johnson & Johnson',
  'johnson and johnson innovative medicine': 'Johnson & Johnson Innovative Medicine',
  'labcorp': 'Labcorp',
  'labroots': 'LabRoots',
  'merck': 'Merck',
  'metrex': 'Metrex',
  'not recorded linkedin posting': 'Employer not recorded',
  'orange county coastkeeper': 'Orange County Coastkeeper',
  'salk institute': 'Salk Institute',
  'sanofi': 'Sanofi',
  'scan health plan': 'SCAN Health Plan',
  'septerna': 'Septerna',
  'simtra biopharma solutions': 'Simtra BioPharma Solutions',
  'terasaki institute': 'Terasaki Institute',
  'thermo fisher': 'Thermo Fisher Scientific',
  'varda space industries': 'Varda Space Industries',
  'zymo research': 'Zymo Research',
};

const sql = await readFile(seedPath, 'utf8');
const rows = sql.split(/\r?\n/)
  .filter((line) => line.startsWith('select _hist('))
  .map((line, index) => {
    const args = parseSqlArguments(line.slice('select _hist('.length, -2));
    if (args.length !== 13) throw new Error(`Historical row ${index + 1} has ${args.length} fields`);
    const [source, companyKey, title, url, location, eligibility, focus, deadlineText, startText, paidStatus, applicationType, notes, dateAdded] = args;
    const cycle = source.startsWith('2024-2025') ? '2024-2025' : '2025-2026';
    return {
      id: `archive-${String(index + 1).padStart(3, '0')}`,
      source,
      cycle,
      companyKey,
      company: displayNames[companyKey] ?? companyKey,
      title,
      url,
      location,
      eligibility,
      focus,
      deadlineText,
      startText,
      paidStatus,
      applicationType,
      notes,
      dateAdded,
    };
  });

if (rows.length !== 51) throw new Error(`Expected 51 historical roles, found ${rows.length}`);
await writeFile(outputPath, `${JSON.stringify({ generatedFrom: 'supabase/seed_historical.sql', roles: rows }, null, 2)}\n`);
console.log(`Wrote ${rows.length} historical roles to ${outputPath}`);
