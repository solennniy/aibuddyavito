# AI-buddy API contract

Legacy Flask prototype. The current React and FastAPI implementation uses the [P0 contract](specs/p0-contract.md).

All JSON uses UTF-8. API calls other than `/api/session` require `Authorization: Bearer <token>`. Fixed demo identities: `intern-anna` (intern, Анна), `intern-ivan` (intern, Иван), `mentor` (mentor, Мария). GET `/api/session` returns `{users:[{token,name,role}]}`. Use `intern-anna` by default.

* GET `/api/session` → `{users:[{token,name,role}]}`.
* POST `/api/chat` accepts `message`, optional `previous_question` and optional `task_id`. It returns `answer`, `sources`, `mode`, the permitted access-request `action`, and an optional `complete_task` proposal with `id` and `title`. Checklist guidance can return a `task_id` to keep short follow-up questions in context. The server checks task scope, resolves progress proposals locally, and sends only authorised synthetic documents to the model.
* Chat only proposes a progress update. After the user confirms, the client calls PATCH `/api/tasks/{id}?include_next=true` with `{"status":"completed"}`. The response contains the saved task and `next_task` (id, title and description), or `null` when there are no remaining checklist tasks.
* GET `/api/requests` → `{requests:[{id,tool,reason,status,result,created_at}]}`. Only caller's records.
* POST `/api/drafts` `{tool:string,reason:string}` → `201 {draft:{id,tool,reason,status,result,created_at}}`. Supported tool: `access` (request access). Draft creates no external action.
* POST `/api/drafts/{id}/confirm` `{confirmed:true}` → `{draft:{id,tool,reason,status,result,created_at}}`. Only its owner, intern role. Confirmation calls a persistent mock service and returns saved result; repeated confirmation is idempotent. A reason containing `[fail-once]` triggers one simulated 503 before a retry succeeds.

Errors: status 400/401/403/404/503, body `{error:{code,message}}`. IDs are integers. `status` is `draft` or `submitted`; `result` is null or `{request_id,status,message}`. The mock is synthetic, not an Avito integration. Dates ISO 8601 UTC. CORS not needed: Flask serves frontend and API same origin.
