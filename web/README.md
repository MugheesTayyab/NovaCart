# Policy Desk: web UI

Next.js 16 app with two separate parts:

| Route | Part | What it is |
| --- | --- | --- |
| `/` | Marketing site | What the desk does, one answer taken apart, the cases it refuses to guess on, how it decides, the policy set |
| `/app` | The desk | Ask a question and see the evidence: details read from the question, version check, sources, rule order, calculation |
| `/app/policies` | The desk | All 22 policy files, with a contact-date control that shows which files are in force |
| `/app/policies/NN` | The desk | One file, item by item, with cross-reference links |
| `/app/conflicts` | The desk | Where two files disagree and which rule in file 00 decides it |
| `/app/evaluation` | The desk | Red-team results from `eval/results/latest.json` (empty until the first run) |

## Run

```bash
cd web
npm install
npm run dev          # http://localhost:3000
npm run build        # production build; also type-checks
npm run typecheck
```

The policy files are read from `../policies` at build time. Nothing is copied or edited.

## Answer service

Set `NEXT_PUBLIC_API_URL` (see `.env.example`) to the FastAPI base URL. The desk sends `POST /ask` with `{ question, history }` and expects the `AskResponse` shape in `src/lib/contract.ts`.

Without it the desk runs in **preview mode**: the four sample questions return hand-checked answers from `src/lib/samples.ts`, and any other question gets a message saying the service is not connected. Preview answers are labelled as such in the UI.

`/app?sample=<id>` opens a sample answer directly. Ids: `partial-return-promo`, `return-window-region`, `gift-card-cod-fee`, `cod-limit-conflict`.

## Deploy

Vercel: import the repository and set **Root Directory** to `web`. The build reads `../policies`, so keep "Include files outside the root directory" enabled (the default).
