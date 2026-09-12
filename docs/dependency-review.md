# Dependency review

Reviewed on 13 September 2026. This is a dependency-advisory check and targeted compatibility review, not a penetration test or guarantee against undisclosed vulnerabilities.

The initial `npm audit --omit=dev` reported 20 affected package entries (18 moderate, two high), including transitive propagation of the same underlying advisories. The final runtime audit reports **zero findings**. CI repeats the runtime audit from the committed lockfile.

## Updates and rationale

| Dependency | Resolution | Relevant behavior |
| --- | --- | --- |
| Sharp | Pin 0.35.4 | Updates bundled image libraries addressing the [libvips](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj) and [libheif](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c) advisories. Its supported Node runtime and metadata, rotation and PNG APIs match this application. Real image/OCR and PDF rendering are regression tested. |
| csv-parse | Pin 7.0.2 | Addresses [prototype replacement through column grouping](https://github.com/advisories/GHSA-8cw4-87c7-c6xx). FieldOps parses arrays of strings and does not enable the affected object-column/grouping options. A literal prototype-like header regression protects this boundary. |
| ws | Override 8.21.0 | Same-major update for Trigger's transitive WebSocket client, addressing [fragment memory exhaustion](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p) and the earlier memory-disclosure advisory. |
| OpenTelemetry core | Override 2.8.0 | Same-major update from 2.7.1 addressing [unbounded baggage allocation](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf). Trigger SDK/build imports pass; hosted telemetry and task execution still require the configured pilot checks. |
| uuid under ExcelJS | Scoped override 11.1.1 | Addresses the [v3/v5/v6 output-buffer bounds advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). Inspected ExcelJS source uses only `v4()` without arguments for conditional-formatting identifiers. The replacement retains CommonJS support and that API. Workbook round-trip tests and browser exports verify the application path. |

The uuid override applies to the installed Node dependency. It does not rewrite ExcelJS's prebuilt browser bundle; that bundle also uses the unaffected `v4()` path. A clean npm audit alone must not be represented as proof that every embedded third-party byte was upgraded. ExcelJS should be revisited when its maintained release updates the browser bundle.

## Remaining development-tool findings

The full `npm audit` still reports **two high-severity package entries** for one underlying issue: `@trigger.dev/build` depends on `@prisma/config`, which pins `deepmerge-ts` 7.1.5. [The advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) requires recursive JavaScript object graphs; plain JSON does not produce the condition. The fix is deepmerge-ts 8, a major version outside the upstream pin.

FieldOps uses no Prisma integration. This dependency is build tooling, not a document parser or application runtime dependency; quotation contents are never passed into Prisma configuration. We retain the upstream dependency rather than silently changing its major version. Use only the repository's trusted build configuration, revisit the upstream fix before adding Prisma, and keep the hosted worker smoke test as a separate gate. Do not describe the full development dependency graph as advisory-free.

## Verification scope

The lockfile pins installed versions. Checks include TypeScript, ESLint, the full unit/integration suite, production build, local browser workflows, real parser benchmark, workbook round-trip and browser export. Import checks load the actual Trigger SDK/build packages and Sharp without dispatching tasks or contacting a model. The [release record](release-verification.md) gives final results and CI evidence.
