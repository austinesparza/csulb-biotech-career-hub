import { fetchGreenhouseJobs } from '../src/lib/ingestion/connectors/greenhouse';
import { GOVERNED_STARTER_SOURCES } from '../src/lib/ingestion/starter-sources';

interface StarterVerification {
  source: string;
  boardToken: string;
  ok: boolean;
  recordsSeen: number;
  recordsArchived: number;
  reviewCandidates: Array<{
    title: string;
    score: number;
    classification: string;
    url: string;
  }>;
  error: string | null;
}

async function main(): Promise<void> {
  const reports: StarterVerification[] = [];

  for (const source of GOVERNED_STARTER_SOURCES) {
    const result = await fetchGreenhouseJobs({
      boardToken: source.boardToken,
      employerName: source.sourceName,
      timeoutMs: 30_000,
    });

    if (!result.ok) {
      reports.push({
        source: source.sourceName,
        boardToken: source.boardToken,
        ok: false,
        recordsSeen: result.recordsSeen,
        recordsArchived: result.recordsNormalized,
        reviewCandidates: [],
        error: result.error.message,
      });
      continue;
    }

    const reviewCandidates = result.candidates
      .filter((candidate) => candidate.relevanceScore >= 35)
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .map((candidate) => ({
        title: candidate.titleRaw ?? candidate.titleNormalized ?? 'Untitled opportunity',
        score: candidate.relevanceScore,
        classification: candidate.classification,
        url: candidate.canonicalUrl,
      }));

    reports.push({
      source: source.sourceName,
      boardToken: source.boardToken,
      ok: true,
      recordsSeen: result.recordsSeen,
      recordsArchived: result.recordsNormalized,
      reviewCandidates,
      error: null,
    });
  }

  process.stdout.write(`${JSON.stringify({ verifiedAt: new Date().toISOString(), reports }, null, 2)}\n`);
  if (reports.some((report) => !report.ok)) process.exitCode = 1;
}

void main();
