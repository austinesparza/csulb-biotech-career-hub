# Compression exemption — do not remove

Caveman, Headroom, RTK, and gateway prompt-compression all rewrite text between
the client and the model.

The extraction pipeline requires every quote to be a LITERAL SUBSTRING of the
stored `raw_text`. If a compressor rewrites a posting in transit, the model
quotes what it was shown, binding checks against what we stored, and EVERY
field fails.

The symptom is indistinguishable from "the model got worse". Do not swap models.

Rules:
1. The extraction worker's traffic is exempt from all compression.
2. If a gateway offers prompt compression, compress the instruction preamble
   only. Never the document under extraction.
3. `lib/integrity.ts` will detect this and say so — verdict
   `transit_corruption` means a proxy is rewriting the payload.
