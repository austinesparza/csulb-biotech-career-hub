import { describe, expect, it } from 'vitest';
import { sourceInstitutionRestriction } from '../../lib/ingestion/source-eligibility';

describe('institution-restricted source board', () => {
  it('blocks the known Northeastern-only board through both Greenhouse token paths', () => {
    expect(sourceInstitutionRestriction({ source_kind: 'greenhouse', source_identifier: 'fspco-op012325' })).toContain('Northeastern University');
    expect(sourceInstitutionRestriction({ source_kind: 'greenhouse', source_identifier: 'other', config_json: { boardToken: 'fspco-op012325' } })).toContain('Northeastern University');
  });

  it('does not block other Flagship company boards or unrelated sources', () => {
    expect(sourceInstitutionRestriction({ source_kind: 'greenhouse', source_identifier: 'flagshippioneering' })).toBeNull();
    expect(sourceInstitutionRestriction({ source_kind: 'greenhouse', source_identifier: 'serifbiomedicines' })).toBeNull();
    expect(sourceInstitutionRestriction({ source_kind: 'ashby', source_identifier: 'fspco-op012325' })).toBeNull();
  });
});
