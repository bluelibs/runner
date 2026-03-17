# ask-runner Example

`ask-runner` is a public Runner-powered HTTP service that answers BlueLibs Runner questions from the repository's `readmes/COMPACT_GUIDE.md`.

It demonstrates:

- a cached docs prompt resource
- a dedicated OpenAI task
- durable SQLite-backed budget and rate-limit state
- public `GET /?query=...` markdown responses
- public `GET /stream?query=...` streaming markdown responses
- public `GET /stream-html?query=...` browser page that live-renders streamed markdown as HTML
- admin controls for stopping or resuming answering for the current day
- prompt-cache aware usage accounting with separate cached-input pricing
- a concurrency cap around OpenAI calls using Runner's `Semaphore`

## Endpoints

- `GET /?query=...` -> returns `text/markdown`
- `GET /stream?query=...` -> streams `text/markdown`
- `GET /stream-html?query=...` -> returns `text/html` and renders the `/stream` response live in the browser
- `GET /health` -> returns JSON health and budget snapshot
- `POST /admin/stop-for-day` -> requires `x-admin-secret`
- `POST /admin/resume` -> requires `x-admin-secret`
- `GET /admin/budget` -> requires `x-admin-secret`

## Environment

Start from `.env.example`.

Important knobs:

- `MAXIMUM_DAILY_BUDGET`: hard daily spend cap in USD
- `ASK_RUNNER_RATE_LIMIT_PER_MINUTE`: per-IP minute limit
- `ASK_RUNNER_RATE_LIMIT_PER_HOUR`: per-IP hour limit
- `ASK_RUNNER_RATE_LIMIT_PER_DAY`: per-IP day limit
- `ASK_RUNNER_MAX_CONCURRENT_OPENAI_CALLS`: max simultaneous OpenAI calls
- `ASK_RUNNER_MAX_OUTPUT_TOKENS`: conservative cap used for both OpenAI and preflight budget estimation
- `ASK_RUNNER_TOKEN_CHARS_ESTIMATE`: chars-per-token estimate used for budget preflight
- `ASK_RUNNER_PRICE_INPUT_PER_1M`: uncached input token price
- `ASK_RUNNER_PRICE_CACHED_INPUT_PER_1M`: cached input token price
- `ASK_RUNNER_PRICE_OUTPUT_PER_1M`: output token price

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

## Skill usage

```text
GET https://ask-runner.bluelibs.com/?query=How%20does%20Runner%20handle%20resource%20lifecycle%3F
GET https://ask-runner.bluelibs.com/stream-html?query=How%20does%20Runner%20handle%20resource%20lifecycle%3F
```
