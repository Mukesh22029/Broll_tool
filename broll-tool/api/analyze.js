// Serverless proxy — keeps your Anthropic API key server-side.
// Works out of the box on Vercel (/api routes). The frontend calls
// POST /api/analyze with { system, user } and gets back { text }.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  // Vercel parses JSON bodies automatically; fall back for other runtimes.
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { system, user } = body;

  if (!user) return res.status(400).json({ error: "Missing 'user' message." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY." });

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: user }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || "Anthropic API error." });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Proxy request failed." });
  }
}
