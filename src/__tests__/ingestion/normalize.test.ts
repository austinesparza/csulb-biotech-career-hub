import { describe, it, expect } from 'vitest';
import {
  normalizeWhitespace,
  normalizeUnicode,
  toCaseInsensitiveKey,
  decodeHtmlEntities,
  htmlToText,
  normalizeEmployerName,
  normalizeJobTitle,
  normalizeJobTitleFamily,
  normalizeLocation,
  normalizeDepartment,
  canonicalizeUrl,
  classifyRemoteType,
  normalizeEmploymentType,
  classifyOpportunity,
  parseIsoDate,
  classifyDeadlineKind,
  inferFocusArea,
} from '../../lib/ingestion/normalize';

describe('normalizeWhitespace', () => {
  it('collapses multiple spaces', () => {
    expect(normalizeWhitespace('foo  bar   baz')).toBe('foo bar baz');
  });
  it('collapses tabs and newlines', () => {
    expect(normalizeWhitespace('foo\t\nbar')).toBe('foo bar');
  });
  it('replaces non-breaking spaces', () => {
    expect(normalizeWhitespace('foo\u00A0bar')).toBe('foo bar');
  });
  it('trims edges', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });
  it('handles empty string', () => {
    expect(normalizeWhitespace('')).toBe('');
  });
  it('is deterministic', () => {
    const input = '  foo  bar\u00A0baz  ';
    expect(normalizeWhitespace(input)).toBe(normalizeWhitespace(input));
  });
});

describe('normalizeUnicode', () => {
  it('applies NFC normalization', () => {
    // é (e + combining acute) should become single codepoint é
    const decomposed = 'e\u0301'; // e + combining acute accent
    const nfc = normalizeUnicode(decomposed);
    expect(nfc).toBe('\u00E9'); // precomposed é
  });
  it('is idempotent', () => {
    const s = 'Bioinformatics & Genomics';
    expect(normalizeUnicode(normalizeUnicode(s))).toBe(normalizeUnicode(s));
  });
});

describe('toCaseInsensitiveKey', () => {
  it('lowercases and normalizes', () => {
    expect(toCaseInsensitiveKey('  Lab Genomics INC  ')).toBe('lab genomics inc');
  });
  it('is deterministic', () => {
    expect(toCaseInsensitiveKey('BIOTECH')).toBe(toCaseInsensitiveKey('biotech'));
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    expect(decodeHtmlEntities('Research &amp; Development')).toBe('Research & Development');
    expect(decodeHtmlEntities('&lt;em&gt;test&lt;/em&gt;')).toBe('<em>test</em>');
    expect(decodeHtmlEntities('Don&apos;t stop')).toBe("Don't stop");
  });
  it('decodes numeric decimal entities', () => {
    expect(decodeHtmlEntities('&#65;')).toBe('A');
    expect(decodeHtmlEntities('&#39;')).toBe("'");
  });
  it('decodes hex entities', () => {
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
  });
  it('leaves unknown entities unchanged', () => {
    expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;');
  });
  it('decodes &nbsp; to space', () => {
    expect(decodeHtmlEntities('foo&nbsp;bar')).toBe('foo bar');
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    const html = '<p>Research &amp; Development</p>';
    expect(htmlToText(html)).toBe('Research & Development');
  });
  it('replaces block tags with spaces', () => {
    const html = '<p>First paragraph</p><p>Second paragraph</p>';
    const result = htmlToText(html);
    expect(result).toBeTruthy();
    expect(result).toContain('First paragraph');
    expect(result).toContain('Second paragraph');
  });
  it('returns null for null input', () => {
    expect(htmlToText(null)).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(htmlToText('')).toBeNull();
  });
  it('strips script and other tags', () => {
    const html = '<div>Content<script>alert(1)</script> here</div>';
    const result = htmlToText(html);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('Content');
    expect(result).toContain('here');
  });
});

describe('normalizeEmployerName', () => {
  it('strips common legal suffixes', () => {
    expect(normalizeEmployerName('Lab Genomics Inc.')).toBe('lab genomics');
    expect(normalizeEmployerName('BioTech Corp')).toBe('biotech');
    expect(normalizeEmployerName('Science Solutions LLC')).toBe('science solutions');
  });
  it('returns null for empty input', () => {
    expect(normalizeEmployerName(null)).toBeNull();
    expect(normalizeEmployerName('')).toBeNull();
  });
  it('preserves scientific terminology', () => {
    const result = normalizeEmployerName('Genomics Research Institute');
    expect(result).toBe('genomics research institute');
  });
  it('decodes HTML entities before normalizing', () => {
    expect(normalizeEmployerName('Bio &amp; Tech Inc')).toBe('bio & tech');
  });
});

describe('normalizeJobTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeJobTitle('Biotechnology Intern!')).toContain('biotechnology intern');
  });
  it('preserves season/year', () => {
    const result = normalizeJobTitle('Summer 2026 Biotechnology Intern');
    expect(result).toContain('summer');
    expect(result).toContain('2026');
  });
  it('returns null for empty input', () => {
    expect(normalizeJobTitle(null)).toBeNull();
    expect(normalizeJobTitle('')).toBeNull();
  });
  it('normalizes em-dash to hyphen', () => {
    const result = normalizeJobTitle('Biotech Intern — Cell Biology');
    expect(result).not.toContain('—');
  });
  it('decodes HTML entities (entity is stripped from normalized form)', () => {
    // &amp; is decoded to &, then & is stripped by punctuation normalization.
    // The key invariant is that the raw HTML entity (&amp;) does not appear in the output.
    const result = normalizeJobTitle('Lab &amp; Research Intern');
    expect(result).not.toContain('&amp;');
    expect(result).toContain('lab');
    expect(result).toContain('intern');
  });
});

describe('normalizeJobTitleFamily', () => {
  it('strips year and season from title', () => {
    const summer = normalizeJobTitleFamily('Summer 2026 Biotechnology Intern');
    const fall = normalizeJobTitleFamily('Fall 2026 Biotechnology Intern');
    expect(summer).toBe(fall);
  });
  it('is not equal for unrelated titles', () => {
    const a = normalizeJobTitleFamily('Biotech Intern');
    const b = normalizeJobTitleFamily('Software Engineer');
    expect(a).not.toBe(b);
  });
  it('returns null for empty input', () => {
    expect(normalizeJobTitleFamily(null)).toBeNull();
  });
});

describe('normalizeLocation', () => {
  it('lowercases and trims', () => {
    expect(normalizeLocation('Long Beach, CA')).toBe('long beach, ca');
  });
  it('returns null for empty/null input', () => {
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation('')).toBeNull();
  });
  it('preserves geographic qualifiers', () => {
    expect(normalizeLocation('Los Angeles, California, USA')).toContain('los angeles');
    expect(normalizeLocation('Los Angeles, California, USA')).toContain('usa');
  });
});

describe('normalizeDepartment', () => {
  it('lowercases department name', () => {
    expect(normalizeDepartment('Research & Development')).toBe('research & development');
  });
  it('returns null for empty input', () => {
    expect(normalizeDepartment(null)).toBeNull();
  });
});

describe('canonicalizeUrl', () => {
  it('removes UTM tracking parameters', () => {
    const url = 'https://boards.greenhouse.io/company/jobs/123?utm_source=linkedin&utm_medium=social';
    const result = canonicalizeUrl(url);
    expect(result).not.toContain('utm_source');
    expect(result).not.toContain('utm_medium');
    expect(result).toContain('boards.greenhouse.io');
  });
  it('removes URL fragments', () => {
    const result = canonicalizeUrl('https://example.com/jobs/123#section1');
    expect(result).not.toContain('#');
  });
  it('lowercases hostname', () => {
    const result = canonicalizeUrl('https://BOARDS.GREENHOUSE.IO/company/jobs/123');
    expect(result).toContain('boards.greenhouse.io');
  });
  it('returns null for invalid URLs', () => {
    expect(canonicalizeUrl('not a url')).toBeNull();
    expect(canonicalizeUrl(null)).toBeNull();
    expect(canonicalizeUrl('')).toBeNull();
  });
  it('returns null for non-HTTP protocols', () => {
    expect(canonicalizeUrl('ftp://example.com/jobs')).toBeNull();
  });
  it('preserves ATS-required query parameters', () => {
    // The 'content=true' parameter is required to get job content
    const url = 'https://boards-api.greenhouse.io/v1/boards/company/jobs?content=true';
    const result = canonicalizeUrl(url);
    expect(result).toContain('content=true');
  });
  it('is deterministic', () => {
    const url = 'https://boards.greenhouse.io/company/jobs/123?ref=footer&utm_source=email';
    expect(canonicalizeUrl(url)).toBe(canonicalizeUrl(url));
  });
});

describe('classifyRemoteType', () => {
  it('detects remote', () => {
    const { remoteType } = classifyRemoteType('Bioinformatics Intern — Remote', 'Remote', null);
    expect(remoteType).toBe('remote');
  });
  it('detects hybrid', () => {
    const { remoteType } = classifyRemoteType('Clinical Intern — Hybrid', 'Los Angeles (Hybrid)', null);
    expect(remoteType).toBe('hybrid');
  });
  it('detects onsite', () => {
    const { remoteType } = classifyRemoteType('Lab Technician', 'Long Beach, CA (On-site)', null);
    expect(remoteType).toBe('onsite');
  });
  it('returns unknown when no signals present', () => {
    const { remoteType } = classifyRemoteType('Lab Intern', 'Long Beach, CA', null);
    expect(remoteType).toBe('unknown');
  });
  it('hybrid takes precedence over remote+onsite', () => {
    const { remoteType } = classifyRemoteType(null, 'Hybrid / On-site', 'remote or on-site');
    expect(remoteType).toBe('hybrid');
  });
  it('is deterministic', () => {
    const a = classifyRemoteType('Intern', 'Remote', null);
    const b = classifyRemoteType('Intern', 'Remote', null);
    expect(a.remoteType).toBe(b.remoteType);
  });
});

describe('normalizeEmploymentType', () => {
  it('normalizes full-time', () => {
    expect(normalizeEmploymentType('Full-Time')).toBe('full_time');
    expect(normalizeEmploymentType('full time')).toBe('full_time');
  });
  it('normalizes part-time', () => {
    expect(normalizeEmploymentType('Part-Time')).toBe('part_time');
  });
  it('normalizes internship', () => {
    expect(normalizeEmploymentType('Internship')).toBe('internship');
  });
  it('returns null for empty input', () => {
    expect(normalizeEmploymentType(null)).toBeNull();
    expect(normalizeEmploymentType('')).toBeNull();
  });
});

describe('classifyOpportunity', () => {
  it('classifies internship from title', () => {
    const { classification } = classifyOpportunity('Biotechnology Intern', null, null);
    expect(classification).toBe('internship');
  });
  it('classifies fellowship from title', () => {
    const { classification } = classifyOpportunity('NIH Summer Fellowship', null, null);
    expect(classification).toBe('fellowship');
  });
  it('classifies research from title', () => {
    const { classification } = classifyOpportunity('Research Scientist I', null, null);
    expect(classification).toBe('research');
  });
  it('classifies entry_level from description', () => {
    const { classification } = classifyOpportunity('Associate Engineer', null, 'entry-level position for new graduates');
    expect(classification).toBe('entry_level');
  });
  it('returns other for unclassifiable role', () => {
    const { classification } = classifyOpportunity('Unrelated Role', null, null);
    expect(classification).toBe('other');
  });
});

describe('parseIsoDate', () => {
  it('parses ISO date', () => {
    expect(parseIsoDate('2026-07-15')).toBe('2026-07-15');
  });
  it('parses ISO datetime with timezone', () => {
    expect(parseIsoDate('2026-06-01T09:00:00-07:00')).toBe('2026-06-01');
  });
  it('parses MM/DD/YYYY', () => {
    expect(parseIsoDate('07/15/2026')).toBe('2026-07-15');
  });
  it('returns null for invalid date', () => {
    expect(parseIsoDate('not-a-real-date')).toBeNull();
    expect(parseIsoDate('2026-02-31')).toBeNull(); // impossible date
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });
  it('returns null for impossible dates', () => {
    expect(parseIsoDate('2026-13-01')).toBeNull(); // month 13
    expect(parseIsoDate('2026-01-32')).toBeNull(); // day 32
  });
  it('is deterministic', () => {
    expect(parseIsoDate('2026-07-15')).toBe(parseIsoDate('2026-07-15'));
  });
});

describe('classifyDeadlineKind', () => {
  it('returns hard for parsed date', () => {
    expect(classifyDeadlineKind('2026-07-15', '2026-07-15')).toBe('hard');
  });
  it('returns rolling for rolling text', () => {
    expect(classifyDeadlineKind('Rolling', null)).toBe('rolling');
    expect(classifyDeadlineKind('open until filled', null)).toBe('rolling');
  });
  it('returns unknown for missing deadline', () => {
    expect(classifyDeadlineKind(null, null)).toBe('unknown');
    expect(classifyDeadlineKind('some text', null)).toBe('unknown');
  });
});

describe('inferFocusArea', () => {
  it('infers bioinformatics from title', () => {
    expect(inferFocusArea('Bioinformatics Intern', null)).toBe('bioinformatics');
  });
  it('infers biochemistry from description', () => {
    expect(inferFocusArea('Lab Intern', 'experience with biochemistry and enzyme kinetics preferred')).toBe('biochemistry');
  });
  it('returns null when no signals', () => {
    expect(inferFocusArea('Unrelated Role', 'no relevant terms here')).toBeNull();
  });
  it('is deterministic', () => {
    expect(inferFocusArea('Genomics Intern', null)).toBe(inferFocusArea('Genomics Intern', null));
  });
});

// ============================================================
// UNICODE-AWARE TITLE AND LOCATION NORMALIZATION
// ============================================================

describe('normalizeJobTitle Unicode preservation', () => {
  it('preserves accented characters in job titles', () => {
    const normalized = normalizeJobTitle('Coordinateur Médical — Santé publique');
    expect(normalized).toContain('médical');
    expect(normalized).toContain('santé');
  });

  it('preserves non-Latin letters (e.g. Japanese)', () => {
    const title = 'Research 研究員 Associate';
    const normalized = normalizeJobTitle(title);
    expect(normalized).toContain('研究員');
  });

  it('preserves ñ in title', () => {
    const normalized = normalizeJobTitle('Técnico en Biotecnología');
    expect(normalized).toContain('técnico');
    expect(normalized).toContain('biotecnología');
  });
});

describe('normalizeLocation Unicode preservation', () => {
  it('preserves accented characters in location names', () => {
    const normalized = normalizeLocation('São Paulo, Brasil');
    expect(normalized).toContain('são paulo');
  });

  it('preserves ü in city name', () => {
    const normalized = normalizeLocation('München, Deutschland');
    expect(normalized).toContain('münchen');
  });
});

// ============================================================
// HYBRID CLASSIFICATION — only explicit hybrid language
// ============================================================

describe('classifyRemoteType hybrid', () => {
  it('classifies as hybrid when "hybrid" is explicitly mentioned', () => {
    const result = classifyRemoteType('Hybrid work schedule available', null, null);
    expect(result.remoteType).toBe('hybrid');
  });

  it('does NOT classify as hybrid for remote + onsite without "hybrid" keyword', () => {
    // "must work on-site some days, but remote work also available"
    const result = classifyRemoteType('Must work on-site but remote work also available', null, null);
    // Should not be hybrid — no explicit "hybrid" word
    expect(result.remoteType).not.toBe('hybrid');
  });

  it('returns unknown with remote_ambiguous flag for contradictory signals', () => {
    // Both remote signal and explicit on-site signal present
    const result = classifyRemoteType('This is a fully remote position.', 'on-site only', null);
    expect(result.remoteType).toBe('unknown');
    expect(result.flags).toContain('remote_ambiguous');
  });
});

// ============================================================
// MONTH-NAME DATE PARSING — should return null
// ============================================================

describe('parseIsoDate month-name dates', () => {
  it('returns null for US-style month-name dates', () => {
    expect(parseIsoDate('March 15, 2026')).toBeNull();
  });

  it('returns null for "15 March 2026" format', () => {
    expect(parseIsoDate('15 March 2026')).toBeNull();
  });

  it('returns null for abbreviated month names', () => {
    expect(parseIsoDate('Mar 15, 2026')).toBeNull();
  });

  it('returns valid result for ISO 8601', () => {
    expect(parseIsoDate('2026-03-15')).toBe('2026-03-15');
  });

  it('returns valid result for slash format', () => {
    const result = parseIsoDate('03/15/2026');
    expect(result).not.toBeNull(); // should parse MM/DD/YYYY
  });
});

// ============================================================
// TRACKING PARAM REMOVAL — case-insensitive
// ============================================================

describe('canonicalizeUrl tracking params case-insensitive removal', () => {
  it('removes UTM_SOURCE (uppercase)', () => {
    const url = canonicalizeUrl('https://example.com/job?UTM_SOURCE=email&id=1');
    expect(url).not.toContain('UTM_SOURCE');
    expect(url).toContain('id=1');
  });

  it('removes Utm_Medium (mixed case)', () => {
    const url = canonicalizeUrl('https://example.com/job?Utm_Medium=cpc');
    expect(url).not.toContain('Utm_Medium');
    expect(url).not.toContain('utm_medium');
  });

  it('removes utm_campaign (lowercase)', () => {
    const url = canonicalizeUrl('https://example.com/job?utm_campaign=spring&jobid=42');
    expect(url).not.toContain('utm_campaign');
    expect(url).toContain('jobid=42');
  });
});

// ============================================================
// CLASSIFICATION — associate director not entry_level
// ============================================================

describe('classifyOpportunity associate/director patterns', () => {
  it('does NOT classify Associate Director as entry_level', () => {
    const result = classifyOpportunity('Associate Director of Research', 'Full-time role for experienced professionals.', null);
    expect(result.classification).not.toBe('entry_level');
  });

  it('does NOT classify Senior Associate as entry_level', () => {
    const result = classifyOpportunity('Senior Associate Scientist', 'Research role requiring 3+ years experience.', null);
    expect(result.classification).not.toBe('entry_level');
  });

  it('does classify research fellowship as fellowship', () => {
    const result = classifyOpportunity('Research Fellowship', 'Summer research fellowship for students.', null);
    expect(result.classification).toBe('fellowship');
  });
});
