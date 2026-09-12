# Machine-learning research methods

## Research question

Can a transparent, human-reviewed retrieval and ranking system find more relevant biotechnology opportunities without increasing unsupported claims or overwhelming the student review team with noise?

The current answer is unknown. The repository contains the infrastructure needed to test the question, but it does not yet contain enough real officer labels to support a production learned ranker.

## Current baseline

The baseline is intentionally deterministic and inspectable:

- versioned biotechnology taxonomy and rule-based classification;
- explicit eligibility, timing, and location extraction with source-bound evidence;
- BM25 lexical retrieval;
- transparent relevance features;
- duplicate and repost detection;
- an officer decision before publication;
- archived source observations and reversible corrections.

Hybrid retrieval, a pluggable embedder, reciprocal-rank fusion, golden cases, must-not-miss cases, and a retrieval benchmark already exist in the repository. Learned ranking remains disabled in `config/ai-tooling.json`.

## Unit of observation and labels

The research record should distinguish four units:

1. **Source observation:** one fetched representation of an employer posting at a stated time.
2. **Candidate:** a normalized opportunity assembled from one or more source observations.
3. **Officer decision:** approval, archival, rejection, correction, and the reason for that outcome.
4. **Recruiting-cycle outcome:** whether the program reappeared, changed timing, changed eligibility, or disappeared in a later cycle.

Officer decisions are the primary real labels. Automated rules and model judgments may create provisional labels for analysis, but they are not ground truth.

## First controlled experiment

### Hypothesis

A contrastive text embedder combined with BM25 through reciprocal-rank fusion will improve recall of relevant roles whose language does not match the controlled taxonomy, without creating new total misses or an unacceptable review burden.

### Comparators

- **Control:** BM25 only.
- **General contrastive candidate:** a small general-purpose embedding model.
- **Budget candidate:** a lower-cost general embedding model.
- **Biomedical candidate:** a biomedical embedding model.

Model selection must be based on this corpus. Biomedical pretraining is not assumed to be superior for job-posting language.

### Evaluation

Use the same labeled queries and documents for every arm. Report:

- recall at 10, 20, and 50;
- precision at 10;
- mean reciprocal rank;
- normalized discounted cumulative gain at 10 and 20;
- total must-not-miss failures;
- irrelevant records presented per officer review session;
- latency and cost per 1,000 candidates.

The current benchmark gate requires at least a 3-point recall-at-20 improvement, no more than a 10-point precision-at-10 loss, and no newly introduced total miss. Those thresholds are starting hypotheses and must be justified against actual officer capacity.

## Label-volume boundary

The configured 30-label minimum is an exploratory floor, not evidence that a learned ranker is ready for production. Thirty outcomes are too few for a reliable train, validation, and held-out test split across employers, degree stages, and scientific disciplines.

Before training a learned ranker:

- verify that each decision records the input features, taxonomy version, model or prompt version, and officer reason available at decision time;
- accumulate labels across multiple employers and at least two recruiting cycles;
- split by employer or cycle to test generalization rather than memorization;
- define class imbalance and review-capacity constraints;
- publish confidence intervals or repeated-split variability, not a single accuracy number.

## Progression

1. **Instrument:** audit decision logging and add missing versioned features in a proposal migration. Do not alter production until reviewed.
2. **Benchmark retrieval:** compare the three embedding candidates with the existing harness.
3. **Shadow:** store experimental rankings without changing the officer queue.
4. **Interleave:** if offline results pass, compare baseline and candidate ordering within the review workflow.
5. **Learn to rank:** only after enough real labels, test an interpretable tree-based ranker over transparent features, lexical score, embedding similarity, and source history.
6. **Allocate search effort:** after multiple cycles, test whether source yield and timing can prioritize crawl frequency. This remains advisory.

## Governance invariants

- A model may prioritize discovery or review work. It may not approve, reject, or publish an opportunity.
- Every public claim must remain traceable to an employer or program source.
- A model change must be versioned, benchmarked, and reversible.
- A new total miss blocks promotion even when aggregate metrics improve.
- Historical recurrence is a search lead, not proof that a role is open now.
- Student identity, application history, work authorization, and other private attributes are not training features for public opportunity ranking.

## Portfolio evidence

A defensible project report should include the data dictionary, labeling protocol, baseline, experimental design, error analysis, confidence intervals, deployment gate, drift monitoring, and examples of changes rejected by the evaluation. The strongest result may be that a simpler system performs as well as a more complex model.
