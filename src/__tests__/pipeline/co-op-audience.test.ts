import { describe, expect, it } from 'vitest';

import { classify, loadTaxonomy } from '../../lib/pipeline/classify';

const taxonomy = loadTaxonomy();

describe('co-op audience classification', () => {
  it('keeps an unrestricted MS-eligible scientific co-op in the graduate audience', () => {
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

  it('keeps an institution-exclusive co-op in the special audience', () => {
    const result = classify({
      title: 'Cell Biology Co-Op',
      employer: 'Flagship Labs',
      body: 'This position is open exclusively to current Northeastern University Co-Op students. Pursuing a BS or MS in Biology. Perform mammalian cell culture and protein assays.',
      location: 'Cambridge, MA',
      url: 'https://example.org/jobs/2',
    }, taxonomy);

    expect(result.keep).toBe(true);
    expect(result.stage.id).toBe('msc_any');
    expect(result.structuralGates).toContainEqual({ id: 'institution_affiliation', bucket: 'special' });
    expect(result.suggestedBucket).toBe('special');
  });

  it('routes an undergraduate-only co-op to the undergraduate audience', () => {
    const result = classify({
      title: 'Cell Biology Co-Op',
      employer: 'Flagship Labs',
      body: "Currently pursuing a bachelor's degree only in Biology or Biochemistry. Perform mammalian cell culture and protein assays.",
      location: 'Cambridge, MA',
      url: 'https://example.org/jobs/3',
    }, taxonomy);

    expect(result.keep).toBe(true);
    expect(result.opportunityType?.scope).toBe('adjacent');
    expect(result.stage.id).toBe('undergrad_only');
    expect(result.suggestedBucket).toBe('undergraduate');
  });

  it('keeps an institution-exclusive undergraduate co-op in the special audience', () => {
    const result = classify({
      title: 'Cell Biology Co-Op',
      employer: 'Flagship Labs',
      body: "This position is open exclusively to current Northeastern University Co-Op students. Currently pursuing a bachelor's degree only in Biology. Perform mammalian cell culture and protein assays.",
      location: 'Cambridge, MA',
      url: 'https://example.org/jobs/4',
    }, taxonomy);

    expect(result.keep).toBe(true);
    expect(result.stage.id).toBe('undergrad_only');
    expect(result.structuralGates).toContainEqual({ id: 'institution_affiliation', bucket: 'special' });
    expect(result.suggestedBucket).toBe('special');
  });
});
