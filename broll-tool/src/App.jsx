import React, { useState, useRef } from "react";
import { Film, Search, Copy, Check, Upload, Clapperboard, ExternalLink, Plus, Loader2, Download, Clock } from "lucide-react";

// ---- design tokens -------------------------------------------------------
const T = {
  ink: "#0E0F13", panel: "#16181F", panel2: "#1C1F28", line: "#2A2E3A",
  amber: "#E8A03D", amberSoft: "#F5C77E", steel: "#8A94A6", paper: "#F2F1EC", green: "#4FB477",
};

// ---- transcript / timecode parsing --------------------------------------
const TC = /(\d{1,2}):(\d{2})(?::(\d{2}))?([.,]\d+)?/;
function toSec(m) {
  if (!m) return null;
  const a = +m[1], b = +m[2], c = m[3] != null ? +m[3] : null;
  return c != null ? a * 3600 + b * 60 + c : a * 60 + b;
}
function parseCues(raw) {
  const lines = raw.split(/\r?\n/);
  const cues = [];
  if (lines.some((l) => l.includes("-->"))) {
    let cur = null;
    for (const l of lines) {
      if (l.includes("-->")) {
        const m = l.split("-->")[0].match(TC);
        cur = { t: toSec(m) || 0, text: "" };
        cues.push(cur);
      } else if (cur && l.trim() && !/^\d+$/.test(l.trim()) && !/^WEBVTT/i.test(l)) {
        cur.text += " " + l.trim();
      }
    }
    return cues.filter((c) => c.text.trim());
  }
  let curT = null, buf = "";
  const push = () => { if (curT != null && buf.trim()) cues.push({ t: curT, text: buf.trim() }); buf = ""; };
  for (const l of lines) {
    const s = l.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) { push(); curT = toSec(s.match(TC)); }
    else buf += " " + s;
  }
  push();
  return cues;
}
function plainText(raw) {
  return raw
    .split(/\r?\n/)
    .filter((l) => !l.includes("-->") && !/^\s*\d+\s*$/.test(l) && !/^WEBVTT/i.test(l))
    .join(" ")
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
function fmt(sec) {
  if (sec == null || isNaN(sec)) return "—";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function placeBeats(beats, cues) {
  if (!cues.length) return beats.map((b) => ({ ...b }));
  const stream = cues.map((c) => ({ t: c.t, n: norm(c.text) }));
  let from = 0;
  const withStart = beats.map((b) => {
    const key = norm(b.quote).split(" ").slice(0, 4).join(" ");
    let start = null;
    for (let i = from; i < stream.length; i++) {
      if (key && stream[i].n.includes(key.split(" ")[0]) && stream[i].n.includes(key.split(" ").slice(-1)[0])) {
        start = stream[i].t; from = i; break;
      }
    }
    return { ...b, start };
  });
  const end = cues[cues.length - 1].t + 4;
  return withStart.map((b, i) => ({ ...b, out: withStart[i + 1] ? withStart[i + 1].start : end }));
}

// ---- api (via same-origin proxy) ----------------------------------------
function parseJSON(text) {
  let s = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}
async function callClaude({ system, user }) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, user }),
  });
  if (!res.ok) {
    let msg = "api " + res.status;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return (await res.json()).text;
}

const BEAT_SYS =
  "You are a story editor for short-form video. Split the transcript into its narrative beats in the order they occur (usually 4 to 7). Return ONLY JSON, no prose, no markdown. Schema: {\"beats\":[{\"n\":1,\"title\":\"2-4 word beat name\",\"role\":\"one short line naming its rhetorical job\",\"quote\":\"verbatim snippet from the transcript, 12 words max\"}]}. Use classic names when they fit (Hook, The Enemy, The Mechanism, Rock Bottom, The Proof, The Button); otherwise name by content. Keep it tight.";

function clipSys(royalty) {
  if (royalty) {
    return "You are a b-roll researcher for cinematic short-form edits. For the given beat, suggest 6 ROYALTY-FREE stock b-roll ideas (no copyrighted film/TV footage). Return ONLY JSON, no prose, no markdown. Schema: {\"clips\":[{\"film\":\"Stock\",\"scene\":\"short visual description\",\"why\":\"why it fits, 14 words max\",\"q\":\"3-6 word stock search term\",\"ts\":\"any clip works\",\"stock\":true}]}.";
  }
  return "You are a b-roll researcher for cinematic motivational edits (the Hormozi style that cuts a talking head to famous film scenes). For the given beat, suggest 6 iconic, easy-to-find movie/TV scenes. Favor well-known films and VARY them (The Social Network, Wolf of Wall Street, Whiplash, Rocky, Creed, Pursuit of Happyness, 8 Mile, King's Speech, Gladiator, Steve Jobs, The Founder, Rudy, Moneyball). The search query should target the ISOLATED single scene (a Movieclips-style cut that starts at 0:00). Return ONLY JSON, no prose, no markdown. Schema: {\"clips\":[{\"film\":\"Title (Year)\",\"scene\":\"short scene description\",\"why\":\"why it fits, 14 words max\",\"q\":\"precise YouTube search query for that exact isolated scene\",\"ts\":\"rough in-film locator like 'opening scene', 'training montage', 'final act'\"}]}.";
}

const ytUrl = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
const pexelsUrl = (q) => "https://www.pexels.com/search/videos/" + encodeURIComponent(q) + "/";
const pixabayUrl = (q) => "https://pixabay.com/videos/search/" + encodeURIComponent(q.replace(/\s+/g, "%20"));

const SAMPLE =
  "You can learn anything that you want by just looking dumb in front of thousands of people for a prolonged time. This is the most underrated skill because people care too much about what other people are thinking about them. And because of that they are not able to make meaningful money in their life. If you can look dumb in front of thousands of people, you won't be afraid of trying out new things in front of everyone. And when you try out new things, when you fail a lot of times, at that time you become successful. And this is my story. I looked a fool in front of a lot of people in 2020. I could not shoot videos. I could not talk properly. But right now, just last year itself, I have taught more than 4 million working professionals in the field of AI. I'm the top AI startup in India, in the Middle East, in UAE, in Saudi Arabia. Just because I took that step.";

// ---- exports -------------------------------------------------------------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
function buildMarkdown(beats, clips, royalty) {
  let md = `# B-roll plan\n\n`;
  beats.forEach((b) => {
    const src = b.start != null ? `${fmt(b.start)} \u2192 ${fmt(b.out)}` : "no source timecode";
    md += `## ${String(b.n).padStart(2, "0")} \u00b7 ${b.title}  \n_${b.role} \u00b7 source ${src}_\n\n> ${b.quote}\n\n`;
    (clips[b.n]?.items || []).forEach((c) => {
      const url = c.stock ? pexelsUrl(c.q) : ytUrl(c.q);
      const loc = c.ts ? ` (\u2248 ${c.ts})` : "";
      md += `- **${c.stock ? "Royalty-free" : c.film}**${loc} \u2014 ${c.scene}. _${c.why}_  \n  ${url}\n`;
    });
    md += `\n`;
  });
  md += `\n> Movie references are for sourcing; copyrighted film footage carries rights risk in commercial posts.${royalty ? " (Royalty-free mode)" : ""}\n`;
  return md;
}
function buildCSV(beats, clips) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["beat", "title", "src_in", "src_out", "source", "in_film", "scene", "why", "search_url"]];
  beats.forEach((b) =>
    (clips[b.n]?.items || []).forEach((c) =>
      rows.push([b.n, b.title, fmt(b.start), fmt(b.out), c.stock ? "Royalty-free" : c.film, c.ts || "", c.scene, c.why, c.stock ? pexelsUrl(c.q) : ytUrl(c.q)])
    )
  );
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

// ---- clip card -----------------------------------------------------------
function ClipCard({ clip }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(clip.q).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  return (
    <div className="clip">
      <div className="clip-top">
        <span className="clip-film">{clip.stock ? "Royalty-free" : clip.film}</span>
        {clip.ts && !clip.stock && <span className="loc">&asymp; {clip.ts}</span>}
      </div>
      <div className="clip-scene">{clip.scene}</div>
      <div className="clip-why">{clip.why}</div>
      <div className="clip-actions">
        {clip.stock ? (
          <>
            <a className="btn btn-amber" href={pexelsUrl(clip.q)} target="_blank" rel="noreferrer"><Search size={13} /> Pexels</a>
            <a className="btn btn-ghost" href={pixabayUrl(clip.q)} target="_blank" rel="noreferrer">Pixabay <ExternalLink size={12} /></a>
          </>
        ) : (
          <a className="btn btn-amber" href={ytUrl(clip.q)} target="_blank" rel="noreferrer"><Search size={13} /> Find on YouTube</a>
        )}
        <button className="btn btn-ghost" onClick={copy} title="Copy search query">
          {copied ? <Check size={13} color={T.green} /> : <Copy size={13} />}{copied ? "Copied" : "Query"}
        </button>
      </div>
    </div>
  );
}

// ---- beat block ----------------------------------------------------------
function BeatBlock({ beat, state, onMore, moreLoading }) {
  const hasTime = beat.start != null;
  const dur = hasTime ? Math.max(0, Math.round(beat.out - beat.start)) : null;
  return (
    <section className="beat">
      <div className="beat-rail">
        <div className="beat-num">{String(beat.n).padStart(2, "0")}</div>
        <div className="beat-spine" />
      </div>
      <div className="beat-body">
        <div className="beat-head">
          <h3 className="beat-title">{beat.title}</h3>
          <span className="beat-role">{beat.role}</span>
          {hasTime && <span className="tcode"><Clock size={11} /> {fmt(beat.start)} &rarr; {fmt(beat.out)} &middot; {dur}s</span>}
        </div>
        <blockquote className="beat-quote">&ldquo;{beat.quote}&rdquo;</blockquote>
        {state?.status === "loading" && (
          <div className="grid">{[0, 1, 2].map((i) => <div className="clip shimmer" key={i} style={{ height: 138 }} />)}</div>
        )}
        {state?.status === "error" && <div className="err small">Couldn&apos;t pull clips. Hit More options to retry.</div>}
        {state?.status === "done" && (
          <>
            <div className="grid">{state.items.map((c, i) => <ClipCard clip={c} key={i} />)}</div>
            <button className="btn btn-line more" onClick={() => onMore(beat)} disabled={moreLoading}>
              {moreLoading ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}More options
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// ---- app -----------------------------------------------------------------
export default function App() {
  const [transcript, setTranscript] = useState("");
  const [royalty, setRoyalty] = useState(false);
  const [beats, setBeats] = useState([]);
  const [clips, setClips] = useState({});
  const [moreBusy, setMoreBusy] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hadTimes, setHadTimes] = useState(true);
  const fileRef = useRef(null);

  const onFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => setTranscript(String(r.result));
    r.readAsText(f);
  };

  const fetchClips = (beat, exclude = []) => {
    const ex = exclude.length ? ` Do not repeat these films: ${exclude.join("; ")}.` : "";
    return callClaude({ system: clipSys(royalty), user: `Beat ${beat.n}: ${beat.title} — ${beat.role}. Quote: "${beat.quote}".${ex}` })
      .then((text) => parseJSON(text).clips || []);
  };

  const analyze = async () => {
    const raw = transcript.trim(); if (!raw) return;
    setError(null); setBeats([]); setClips({}); setBusy(true);
    const cues = parseCues(raw);
    setHadTimes(cues.length > 0);
    try {
      const text = await callClaude({ system: BEAT_SYS, user: plainText(raw) });
      let bs = (parseJSON(text).beats || []).slice(0, 8);
      if (!bs.length) throw new Error("no beats");
      bs = placeBeats(bs, cues);
      setBeats(bs);
      setBusy(false);
      bs.forEach((b) => {
        setClips((p) => ({ ...p, [b.n]: { status: "loading", items: [] } }));
        fetchClips(b).then((items) => setClips((p) => ({ ...p, [b.n]: { status: "done", items } })))
          .catch(() => setClips((p) => ({ ...p, [b.n]: { status: "error", items: [] } })));
      });
    } catch (e) {
      setBusy(false);
      setError(String(e.message || "").includes("api")
        ? "The analysis service didn't respond. Check the server's API key and try again."
        : "Couldn't read the beats. Try again, or trim the transcript to the spoken words.");
    }
  };

  const onMore = (beat) => {
    const existing = (clips[beat.n]?.items || []).map((c) => c.film).filter((f) => f && f !== "Stock");
    setMoreBusy((p) => ({ ...p, [beat.n]: true }));
    fetchClips(beat, existing).then((items) => {
      setClips((p) => {
        const prev = p[beat.n]?.items || [];
        const seen = new Set(prev.map((c) => c.film + c.scene));
        return { ...p, [beat.n]: { status: "done", items: [...prev, ...items.filter((c) => !seen.has(c.film + c.scene))] } };
      });
    }).finally(() => setMoreBusy((p) => ({ ...p, [beat.n]: false })));
  };

  const ready = beats.length > 0 && Object.values(clips).some((c) => c?.status === "done");

  return (
    <div className="root">
      <style>{CSS}</style>
      <div className="grain" />
      <div className="wrap">
        <header className="hdr">
          <div className="eyebrow"><Clapperboard size={13} /> House of EdTech &middot; B-roll Engine</div>
          <h1 className="h1">Transcript <span className="arrow">&rarr;</span> <em>Cutaways</em></h1>
          <p className="sub">Drop in a talking-head transcript. Get it mapped into beats with real source timecodes, cinematic clip options, and a downloadable plan.</p>
        </header>

        <div className="input-card">
          <textarea className="ta" rows={7}
            placeholder="Paste the transcript — or upload an .srt / .vtt to get exact source timecodes per beat…"
            value={transcript} onChange={(e) => setTranscript(e.target.value)} />
          <div className="controls">
            <div className="controls-left">
              <button className="btn btn-line" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload .txt / .srt / .vtt</button>
              <input ref={fileRef} type="file" accept=".txt,.srt,.vtt,.md" hidden onChange={onFile} />
              <button className="btn btn-line" onClick={() => setTranscript(SAMPLE)}>Use sample</button>
              <label className="toggle">
                <input type="checkbox" checked={royalty} onChange={(e) => setRoyalty(e.target.checked)} />
                <span className="track"><span className="knob" /></span>Royalty-free only
              </label>
            </div>
            <button className="btn btn-amber lg" onClick={analyze} disabled={busy || !transcript.trim()}>
              {busy ? <Loader2 size={15} className="spin" /> : <Film size={15} />}{busy ? "Reading the beats…" : "Map the beats"}
            </button>
          </div>
          {error && <div className="err">{error}</div>}
        </div>

        {!beats.length && !busy && (
          <div className="empty">
            <div className="empty-strip">{["Hook", "Enemy", "Mechanism", "Rock bottom", "Proof", "Button"].map((s, i) => <span key={i} className="empty-chip">{s}</span>)}</div>
            <p>Each beat returns 6 scene options with an in-film locator, and you can pull more anytime. Upload an .srt for exact in/out timecodes in your own footage.</p>
          </div>
        )}

        {ready && (
          <div className="exportbar">
            {!hadTimes && <span className="hint">No timecodes found — upload an .srt/.vtt for exact beat in/out.</span>}
            <div className="exp-btns">
              <button className="btn btn-line" onClick={() => download("broll_plan.md", buildMarkdown(beats, clips, royalty), "text/markdown")}><Download size={14} /> Plan (.md)</button>
              <button className="btn btn-line" onClick={() => download("broll_plan.csv", buildCSV(beats, clips), "text/csv")}><Download size={14} /> Sheet (.csv)</button>
            </div>
          </div>
        )}

        <div className="beats">
          {beats.map((b) => <BeatBlock key={b.n} beat={b} state={clips[b.n]} onMore={onMore} moreLoading={!!moreBusy[b.n]} />)}
        </div>

        {beats.length > 0 && (
          <footer className="foot">
            <b>Source timecodes</b> are read from your uploaded captions — exact. <b>In-film locators</b> (&asymp;) are approximate; searches point at isolated single-scene uploads that start at 0:00, so eyeball the exact frame. Copyrighted film footage carries rights risk in commercial posts — use <b>Royalty-free only</b> for clearance-safe stock.
          </footer>
        )}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; }
.root { position: relative; min-height: 100%; background: radial-gradient(1200px 600px at 80% -10%, rgba(232,160,61,0.10), transparent 60%), ${T.ink}; color: ${T.paper}; font-family: Inter, system-ui, sans-serif; }
.grain { position: fixed; inset: 0; pointer-events: none; opacity: 0.05; z-index: 0; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.wrap { position: relative; z-index: 1; max-width: 1040px; margin: 0 auto; padding: 40px 22px 64px; }
.eyebrow { display: inline-flex; align-items: center; gap: 7px; color: ${T.amber}; font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; }
.h1 { font-family: 'Bebas Neue', sans-serif; font-weight: 400; letter-spacing: 0.01em; font-size: clamp(44px, 8vw, 92px); line-height: 0.92; margin: 10px 0 12px; }
.h1 em { color: ${T.amber}; font-style: normal; }
.h1 .arrow { color: ${T.steel}; font-family: Inter; font-size: 0.5em; vertical-align: 0.16em; }
.sub { color: ${T.steel}; max-width: 640px; font-size: 15px; line-height: 1.6; margin: 0; }
.input-card { margin-top: 28px; background: ${T.panel}; border: 1px solid ${T.line}; border-radius: 16px; padding: 16px; }
.ta { width: 100%; resize: vertical; background: ${T.ink}; color: ${T.paper}; border: 1px solid ${T.line}; border-radius: 11px; padding: 14px; font-size: 14px; line-height: 1.6; font-family: Inter; outline: none; }
.ta:focus { border-color: ${T.amber}; }
.ta::placeholder { color: #5b616f; }
.controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-top: 12px; }
.controls-left { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.btn { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; border-radius: 9px; font-size: 13px; font-weight: 600; font-family: Inter; padding: 9px 13px; border: 1px solid transparent; transition: all 0.15s ease; white-space: nowrap; text-decoration: none; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-amber { background: ${T.amber}; color: #201400; }
.btn-amber:hover:not(:disabled) { background: ${T.amberSoft}; }
.btn-line { background: transparent; border-color: ${T.line}; color: ${T.paper}; }
.btn-line:hover:not(:disabled) { border-color: ${T.steel}; }
.btn-ghost { background: transparent; color: ${T.steel}; padding: 8px 10px; }
.btn-ghost:hover { color: ${T.paper}; }
.btn.lg { padding: 11px 18px; font-size: 14px; }
.toggle { display: inline-flex; align-items: center; gap: 9px; color: ${T.steel}; font-size: 13px; font-weight: 500; cursor: pointer; user-select: none; }
.toggle input { display: none; }
.track { width: 34px; height: 19px; border-radius: 20px; background: ${T.line}; position: relative; transition: background 0.15s; }
.knob { position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: ${T.steel}; transition: all 0.15s; }
.toggle input:checked + .track { background: rgba(232,160,61,0.35); }
.toggle input:checked + .track .knob { left: 17px; background: ${T.amber}; }
.err { margin-top: 12px; color: #E88A6A; font-size: 13px; }
.err.small { margin: 8px 0 0; }
.empty { margin-top: 30px; text-align: center; color: ${T.steel}; }
.empty-strip { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 14px; }
.empty-chip { border: 1px dashed ${T.line}; border-radius: 999px; padding: 6px 14px; font-size: 12px; letter-spacing: 0.04em; color: ${T.steel}; }
.empty p { max-width: 500px; margin: 0 auto; font-size: 14px; line-height: 1.6; }
.exportbar { margin-top: 26px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.hint { color: ${T.amberSoft}; font-size: 12px; }
.exp-btns { display: flex; gap: 8px; margin-left: auto; }
.beats { margin-top: 22px; }
.beat { display: grid; grid-template-columns: 52px 1fr; gap: 8px; }
.beat-rail { display: flex; flex-direction: column; align-items: center; }
.beat-num { font-family: 'Bebas Neue', sans-serif; font-size: 30px; color: ${T.amber}; line-height: 1; padding-top: 2px; }
.beat-spine { flex: 1; width: 2px; margin-top: 8px; background: repeating-linear-gradient(${T.line} 0 6px, transparent 6px 12px); }
.beat-body { padding-bottom: 34px; }
.beat-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.beat-title { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: 27px; letter-spacing: 0.02em; margin: 0; }
.beat-role { color: ${T.steel}; font-size: 13px; }
.tcode { display: inline-flex; align-items: center; gap: 5px; color: ${T.amber}; font-size: 12px; font-weight: 600; background: rgba(232,160,61,0.10); border: 1px solid rgba(232,160,61,0.25); padding: 3px 9px; border-radius: 999px; }
.beat-quote { margin: 8px 0 16px; padding-left: 13px; border-left: 2px solid ${T.amber}; color: #C9CDD6; font-size: 14px; font-style: italic; line-height: 1.5; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 860px) { .grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } .beat { grid-template-columns: 40px 1fr; } }
.clip { background: ${T.panel}; border: 1px solid ${T.line}; border-radius: 13px; padding: 14px; display: flex; flex-direction: column; transition: border-color 0.15s, transform 0.15s; animation: fadeUp 0.35s ease both; }
.clip:hover { border-color: rgba(232,160,61,0.5); transform: translateY(-2px); }
.clip-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.clip-film { font-weight: 700; font-size: 14px; color: ${T.paper}; }
.loc { font-size: 10.5px; color: ${T.steel}; border: 1px solid ${T.line}; border-radius: 999px; padding: 2px 7px; white-space: nowrap; }
.clip-scene { font-size: 13px; color: #C0C5CF; line-height: 1.45; }
.clip-why { font-size: 12px; color: ${T.amberSoft}; margin-top: 8px; line-height: 1.4; flex: 1; }
.clip-actions { display: flex; gap: 6px; margin-top: 12px; align-items: center; flex-wrap: wrap; }
.more { margin-top: 14px; }
.shimmer { position: relative; overflow: hidden; border-style: dashed; animation: none; }
.shimmer::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent); animation: sweep 1.2s infinite; }
.foot { margin-top: 10px; color: #6b7280; font-size: 12px; line-height: 1.7; border-top: 1px solid ${T.line}; padding-top: 16px; }
.foot b { color: ${T.steel}; font-weight: 600; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes sweep { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .clip { animation: none; } .shimmer::after { animation: none; } .spin { animation: none; } }
`;
