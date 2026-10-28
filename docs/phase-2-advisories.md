# Phase 2 audit remediation: dependency advisories

Reviewed 2026-10-29. **F05 UNRESOLVED**: four inherited moderate vulnerabilities remain visible; none is suppressed. The independent Phase 2 FAIL is preserved. This source-level reachability assessment is not an independent approval or proof of non-exploitability.

Evidence: `pnpm audit --json` (exit 1), [audit snapshot](audits/phase-2-remediation-dependency-audit.json), `pnpm why -r decode-uri-component stream-json`, installed SDK source and registry metadata. The audit reports 4 moderate, 0 low/high/critical across 533 dependencies. Phase 1 advisory history is unchanged.

| Advisory | Installed chain | Fix and disposition |
|---|---|---|
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | API/worker → minio 8.0.7 → query-string 7.1.3 → decode-uri-component 0.2.2 | Fixed ≥0.5.0; current 0.5.1 uses ESM, outside query-string's ^0.2.0 range and CommonJS callable contract. Unresolved. |
| [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x) | API/worker → minio 8.0.7 → stream-json 1.9.1 | Filter DoS fixed ≥3.5.0; incompatible major/module/exports change. Unresolved. |
| [GHSA-hqr4-qq8f-hg3x](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x) | Same stream-json chain | JSONC parsing issue fixed ≥3.6.0. Unresolved. |
| [GHSA-mjw6-4jj6-33hc](https://github.com/advisories/GHSA-mjw6-4jj6-33hc) | Same stream-json chain | Assembler prototype pollution fixed ≥3.6.0. Unresolved. |

Registry checks found MinIO 8.0.7 remains the latest stable SDK and declares query-string ^7.1.3 and stream-json ^1.8.0. See [upstream releases](https://github.com/minio/minio-js/releases) and [manifest](https://github.com/minio/minio-js/blob/master/package.json). Latest query-string 10.0.0 and stream-json 3.7.0 are outside those ranges. MinIO's CommonJS import of `stream-json/jsonl/Parser.js` also needs review against v3's ESM exports through `src`. No compatible upstream fix was identified; no blind major override was added.

Installed MinIO `dist/main/internal/client.js` uses query-string stringify, not the vulnerable decoding path. Its `notification.js` imports the JSONL parser, but application code does not call `listenBucketNotification`. No application use of the affected stream filters, JSONC parsing, or Assembler was found. Phase 2 SMTP outbox notifications do not use MinIO notification streams. Based on that source review, Phase 2 introduces no identified new execution path to these vulnerable functions. The packages remain present and vulnerable; reassess before any new storage/stream processing workflow.

Residual risk requires independent review and either an upstream SDK migration or a reviewed compatible backport. This report does not cover container/Go advisories, production exposure, or future recruitment functionality.
