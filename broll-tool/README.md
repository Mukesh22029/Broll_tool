# B-roll Engine

Paste a talking-head transcript → get it mapped into narrative beats, each with 6 cinematic clip options and links. Runs on your own Anthropic API key, so it works on a public domain with **no Claude login wall** for visitors.

## What's inside

```
broll-tool/
├─ api/analyze.js     ← serverless proxy that holds your API key (server-side)
├─ src/App.jsx        ← the whole app UI
├─ src/main.jsx
├─ index.html
├─ package.json
├─ vite.config.js
└─ .env.example
```

The browser never sees your key. The frontend calls `/api/analyze`; that function adds the key and forwards the request to Anthropic.

## Deploy on Vercel (easiest, ~3 min)

1. Push this folder to a GitHub repo (or run `vercel` from the folder with the Vercel CLI).
2. In Vercel, **New Project → import the repo.** It auto-detects Vite; no build config needed.
3. **Project → Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com
   - *(optional)* `ANTHROPIC_MODEL` = `claude-sonnet-5` (default) or `claude-haiku-4-5-20251001` for cheaper/faster
4. **Deploy.** You'll get a public URL like `broll-engine.vercel.app`. Add your own domain in Settings → Domains.

## Run locally

You need the Vercel CLI so the `/api` function runs alongside Vite:

```bash
npm install
npm i -g vercel
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env      # for local dev
vercel dev                                        # serves frontend + /api together
```

(`npm run dev` alone starts only the frontend — the analyze call will 404 without `vercel dev`.)

## Netlify instead

Rename `api/analyze.js` to `netlify/functions/analyze.js`, wrap it in Netlify's handler signature, and set the same env var. The frontend fetch path becomes `/.netlify/functions/analyze` (change it in `src/App.jsx`).

## Cost & safety (important for a public tool)

- Every "Map the beats" run is ~7 short model calls (1 for beats + 1 per beat + any "More options"). With `claude-haiku-4-5` this is fractions of a cent per run; Sonnet is a bit more. **All of it bills to your key**, so:
  - Set a **monthly spend limit** in the Anthropic Console.
  - Since the endpoint is public, consider a light gate before launch: a shared password, Cloudflare Turnstile / a CAPTCHA, or Vercel's built-in protection — otherwise anyone who finds the URL can spend your credits.
- Check the current model list before launch — model IDs change over time: https://docs.claude.com/en/docs/about-claude/models

## Notes

- Copyrighted film footage carries rights risk in commercial posts. The **Royalty-free only** toggle switches suggestions to stock ideas with Pexels/Pixabay links, which are cleared for commercial use.
- Source timecodes are exact only when you upload an `.srt`/`.vtt` (or a timestamped transcript). In-film locators (≈) are approximate by design.
