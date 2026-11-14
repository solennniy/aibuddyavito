# AI-buddy: behavioral and integration specification

Legacy Flask prototype. See the [P0 contract](p0-contract.md) and [SDD](../docs/spec.md) for the current implementation.

## Actors and trust boundary
Synthetic demo identities are provided by a fixed mapping; bearer tokens emulate a corporate identity provider. They are not production authentication. The backend, not the model or browser, derives the identity, enforces roles and object ownership, and filters documents by access before sending context to a model. The model is limited to answering from the accessible synthetic context and cannot authorize or call tools itself.

## Interaction contract
The API contract is in CONTRACT.md. Actions follow draft → user confirmation → server authorization → mock service → persist response → show status. No action occurs merely from chat or draft creation. The mock service stores an idempotency key derived from the draft; a retry returns the original result rather than creating duplicates. Requests and drafts are visible to their owner. Unauthorized operations return an explicit error without data leakage. Corporate service and identities are imitations, not Avito systems.

## Answering
Filter knowledge sources for the current role and identity before constructing context. Unavailable sources never reach an LLM or response. Ground the answer in permitted synthetic documents and return references; no matching document means an explicit uncertainty and direction to a human. A missing model configuration enables a clearly indicated deterministic demonstration mode. Timeouts or provider errors produce an error, not a fabricated success. LLM network requests must have a timeout.

## Failure and UI
Invalid inputs, missing identity, denied access, unknown records, provider failures and mock failures have structured responses. Failed submissions retain the draft and permit retry. Locally available UI interactions should respond under one second; network calls are asynchronous with waiting and error states.

## Acceptance and verification
1. A demo intern gets an answer and references only permitted synthetic sources.
2. A draft does not create a service request; explicit confirmation returns and saves the mock result.
3. Repeating confirmation returns the same result and creates only one mock request.
4. Another intern cannot read or confirm the draft; a disallowed role cannot act.
5. Simulated service failure leaves the draft retryable and retry succeeds.
6. Reloading the application preserves state in the database.
7. Invalid and unauthorized requests return stable structured errors.
8. Automated tests cover the cases above; a repeatable coverage report exceeds 80% of team-authored application lines, excluding dependencies and tests.
9. Documentation identifies the external model, configuration variables, demo limitations, and steps to launch and verify.
