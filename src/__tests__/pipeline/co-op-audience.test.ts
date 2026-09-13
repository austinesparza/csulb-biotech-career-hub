import { describe, expect, it } from 'vitest';

import { classify, loadTaxonomy } from '../../lib/pipeline/classify';

const taxonomy = loadTaxonomy();

describe('co-op audience classification', () => {
  it('keeps an MS-eligible scientific co-op in the graduate audience', () => {
    const result = classify({
      title: 'Cell Biology Co-Op',
      employer: 'Flagship Labs',
      body: 'Pursuing a BS or MS in Biology, Cell Biology, Molecular Biology, or Biochemistry. Perform mammalian cell culture, protein assays, and drug discovery research.',
      location: 'Cambridge, MA',
      url: 'https://example.org/jobs/1',
    }, taxonomy);

    expect(result.keep).toBe(true);
    expect(result.opportunityType?.scope).toBe('adjacent');
    expect(result.stage.id).toBe('msc_any');
    expect(result.suggestedBucket).toBe('graduate');
  });

  it('does not promote an undergraduate-only co-op to the graduate audience', () => {
    const result = classify({
      title: 'Cell Biology Co-Op',
      employer: 'Flagship Labs',
      body: "Currently pursuing a bachelor's degree only in Biology or Biochemistry. Perform mammalian cell culture and protein assays.",
      location: 'Cambridge, MA',
      url: 'https://example.org/jobs/2',
    }, taxonomy);

    expect(result.keep).toBe(true);
    expect(result.opportunityType?.scope).toBe('adjacent');
    expect(result.stage.id).toBe('undergrad_only');
    expect(result.suggestedBucket).toBe('excluded');
  });
});
