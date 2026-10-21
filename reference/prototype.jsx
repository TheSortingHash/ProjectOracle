// Original Claude-artifact prototype, kept for UI reference only (handoff §2).
// Do not reuse its data flow: it calls the API from the browser, sends the full
// corpus on every request, and parses JSON out of free text.
import { useState, useRef, useEffect, useCallback } from "react";

const DAP_BLUE = "#1C2790";
const DAP_GOLD = "#CDAE2C";
const HEADER_LOGO = "https://coe-psp.dap.edu.ph/wp-content/uploads/2022/06/dap-logo.png";
const BOT_AVATAR  = "https://serp-p.pids.gov.ph/media/default/featured-image/dap_vertical_logo.png";
const ROLES = ["General Staff", "Policy Maker", "Program Manager"];
const INGEST_STEPS = ["Extracting Text", "Chunking", "Embedding", "Saving to Vector DB"];
const ROLE_COLORS = {
  "General Staff":   { bg: "#EEF0FC", color: DAP_BLUE },
  "Policy Maker":    { bg: "#FDF6DC", color: "#7A5F00" },
  "Program Manager": { bg: "#E6F9F1", color: "#15643A" },
};

// ── Logo components with branded fallbacks ────────────────────
function HeaderLogo() {
  const [err, setErr] = useState(false);
  if (err) return (
    <div className="h-9 flex items-center justify-center px-2 rounded font-bold text-sm" style={{ background: DAP_GOLD, color: DAP_BLUE }}>DAP</div>
  );
  return <img src={HEADER_LOGO} alt="DAP" className="h-9 object-contain" onError={() => setErr(true)} />;
}
function BotAvatar({ size = 6 }) {
  const [err, setErr] = useState(false);
  const px = size * 4;
  if (err) return (
    <div className="rounded-full flex items-center justify-center flex-shrink-0 font-bold text-xs"
      style={{ width: px, height: px, background: DAP_GOLD, color: DAP_BLUE, fontSize: 10 }}>D</div>
  );
  return <img src={BOT_AVATAR} alt="DAP Bot" className={`w-${size} h-${size} object-contain rounded flex-shrink-0`} onError={() => setErr(true)} />;
}

// ── PDF.js loader ─────────────────────────────────────────────
let pdfjsLib = null;
const loadPdfJs = () => new Promise((resolve, reject) => {
  if (pdfjsLib) return resolve(pdfjsLib);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  s.onload = () => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfjsLib = window.pdfjsLib;
    resolve(pdfjsLib);
  };
  s.onerror = reject;
  document.head.appendChild(s);
});

async function extractTextFromPDF(buf) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buf }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const ct = await page.getTextContent();
    out += `\n--- Page ${i} ---\n` + ct.items.map(x => x.str).join(" ");
  }
  return out.trim();
}

// ── Robust JSON extractor ─────────────────────────────────────
function extractJSON(raw) {
  if (!raw) return null;
  // 1. strip markdown fences
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // 2. try direct parse
  try { const r = JSON.parse(s); if (r && r.answer !== undefined) return r; } catch (_) {}
  // 3. find outermost { }
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { const r = JSON.parse(s.slice(start, end + 1)); if (r && r.answer !== undefined) return r; } catch (_) {}
  }
  // 4. regex — grab everything between first { and last }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { const r = JSON.parse(m[0]); if (r && r.answer !== undefined) return r; } catch (_) {} }
  return null;
}

function safeParse(raw) {
  const p = extractJSON(raw);
  if (p) return {
    answer: p.answer || "",
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
    citations: Array.isArray(p.citations) ? p.citations : [],
    forms: Array.isArray(p.forms) ? p.forms : [],
    complianceChecklist: Array.isArray(p.complianceChecklist) ? p.complianceChecklist : [],
  };
  // last resort — show the raw text rather than broken JSON
  return { answer: raw, warnings: [], citations: [], forms: [], complianceChecklist: [] };
}

// ── Prompts ───────────────────────────────────────────────────
function buildDocContext(docs) {
  return docs.map(d => `=== DOCUMENT: ${d.name} ===\n${d.text}\n=== END: ${d.name} ===`).join("\n\n");
}

function getSystemPrompt(role, scenarioMode, ctx) {
  return `You are the official Policy Assistant for the Development Academy of the Philippines (DAP).

RULE 1 — ANSWER ONLY FROM DOCUMENTS: Use ONLY the policy documents below. No outside knowledge. If not found, set answer to "I cannot find this information in the provided DAP policy documents."

RULE 2 — OUTPUT FORMAT (CRITICAL): Your response must be ONLY a JSON object. No markdown. No backticks. No prose. No explanation. No text before or after the JSON. Your very first character must be { and your very last character must be }.

JSON SCHEMA (use exactly this):
{"answer":"string","warnings":[{"year":"string","amendedBy":"string"}],"citations":[{"document":"string","page":"string"}],"forms":[{"name":"string","filename":"string"}],"complianceChecklist":[{"rule":"string","applicable":true,"source":"string"}]}

FIELD RULES:
- answer: plain text summary of your response (no JSON, no markdown inside this field)
- warnings: only if a document explicitly says a rule was superseded/amended; else []
- citations: always cite the exact document name and page/section for every claim; never []
- forms: only for travel/leave/reimbursement/procurement/disbursement; else []
- complianceChecklist: ${scenarioMode ? "REQUIRED for scenario mode — list each applicable rule as a separate item with source; keep each rule under 20 words" : "always []"}

POLICY DOCUMENTS:
${ctx || "No documents uploaded yet."}

Role behavior for "${role}":
${role === "General Staff" ? "Simple plain language, no jargon." : ""}
${role === "Policy Maker" ? "Authoritative analysis, cite MC numbers, flag conflicts in warnings." : ""}
${role === "Program Manager" ? "Focus on budgets, procurement, honoraria. Reference PMDP/BAGANI if relevant." : ""}`;
}

// ── PDF Viewer Modal ──────────────────────────────────────────
function PdfViewerModal({ doc, onClose }) {
  const canvasRef = useRef();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(1);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({ data: doc.buffer.slice(0) }).promise;
      if (!dead) { setPdfDoc(pdf); setTotal(pdf.numPages); }
    })();
    return () => { dead = true; };
  }, [doc]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let dead = false;
    setRendering(true);
    (async () => {
      const pg = await pdfDoc.getPage(page);
      const vp = pg.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current;
      if (!canvas || dead) return;
      canvas.width = vp.width; canvas.height = vp.height;
      await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      if (!dead) setRendering(false);
    })();
    return () => { dead = true; };
  }, [pdfDoc, page]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ width: 720, maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0" style={{ background: DAP_BLUE }}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white text-lg">📄</span>
            <span className="text-white text-sm font-semibold truncate">{doc.name}</span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1}
                className="w-7 h-7 rounded text-white flex items-center justify-center disabled:opacity-30 hover:bg-blue-800">‹</button>
              <span className="text-white text-xs px-1">{page} / {total}</span>
              <button onClick={() => setPage(p => Math.min(total, p+1))} disabled={page >= total}
                className="w-7 h-7 rounded text-white flex items-center justify-center disabled:opacity-30 hover:bg-blue-800">›</button>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center text-white hover:bg-blue-800 text-lg">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-gray-100 flex items-start justify-center p-4 relative">
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 bg-opacity-80 z-10">
              <div className="flex gap-1">{[0,1,2].map(i=><div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{background:DAP_BLUE,animationDelay:`${i*0.15}s`}}/>)}</div>
            </div>
          )}
          <canvas ref={canvasRef} className="shadow-lg rounded" style={{ maxWidth: "100%" }} />
        </div>
      </div>
    </div>
  );
}

// ── Citation link with hover preview ─────────────────────────
function CitationLink({ c, docs, onOpen }) {
  const [hover, setHover] = useState(false);
  const doc = docs.find(d => d.name === c.document);
  const snippet = doc ? doc.text.slice(0, 280).replace(/\s+/g, " ") + "…" : null;
  return (
    <div className="relative">
      <button onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={() => doc && onOpen(doc)}
        className="block text-xs text-left hover:underline" style={{ color: DAP_BLUE }}>
        📎 {c.document} — {c.page}
      </button>
      {hover && doc && (
        <div className="absolute left-0 bottom-full mb-2 z-30 bg-white border border-gray-200 rounded-xl shadow-xl p-3 pointer-events-none" style={{ width: 280 }}>
          <p className="text-xs font-bold mb-0.5 truncate" style={{ color: DAP_BLUE }}>{doc.name}</p>
          <p className="text-xs text-gray-500 mb-1">Ref: <span className="font-medium">{c.page}</span></p>
          <p className="text-xs text-gray-600 leading-relaxed border-t pt-1" style={{ maxHeight: 90, overflow: "hidden" }}>{snippet}</p>
          <p className="text-xs mt-1.5 font-semibold" style={{ color: DAP_GOLD }}>Click to open viewer →</p>
        </div>
      )}
    </div>
  );
}

// ── Welcome message ───────────────────────────────────────────
const WELCOME = {
  id: "w0", role: "assistant", persona: null,
  answer: "Welcome to the DAP Policy Assistant. Upload your policy documents in the Admin Panel. I will answer questions exclusively based on those documents.",
  warnings: [], citations: [], forms: [], complianceChecklist: []
};

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [role, setRole] = useState("General Staff");
  const [scenarioMode, setScenarioMode] = useState(false);
  const [docs, setDocs] = useState([]);
  const [ingesting, setIngesting] = useState(false);
  const [ingestStep, setIngestStep] = useState(-1);
  const [ingestFileName, setIngestFileName] = useState("");
  const [ingestError, setIngestError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [simplified, setSimplified] = useState({});
  const [simplifying, setSimplifying] = useState({});
  const [pdfViewer, setPdfViewer] = useState(null);
  const [history, setHistory] = useState([]);
  const fileRef = useRef();
  const endRef = useRef();

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const runIngestion = async (files) => {
    setIngesting(true); setIngestError("");
    for (const f of files) {
      if (docs.find(d => d.name === f.name)) continue;
      setIngestFileName(f.name);
      try {
        setIngestStep(0);
        const text = await extractTextFromPDF(f.buffer.slice(0));
        for (let s = 1; s < INGEST_STEPS.length; s++) { setIngestStep(s); await new Promise(r => setTimeout(r, 450)); }
        setDocs(prev => [...prev, { name: f.name, date: new Date().toLocaleDateString("en-PH"), size: f.size, text, buffer: f.buffer, status: "Indexed" }]);
        setHistory([]);
      } catch (e) { setIngestError(`Failed: "${f.name}" — ${e.message}`); }
    }
    setIngestStep(-1); setIngesting(false); setIngestFileName("");
  };

  const readFiles = async (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.type === "application/pdf");
    if (!pdfs.length) return;
    const data = await Promise.all(pdfs.map(f => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res({ name: f.name, buffer: e.target.result, size: (f.size/1024).toFixed(1)+" KB" });
      r.onerror = () => rej(new Error("Read failed"));
      r.readAsArrayBuffer(f);
    })));
    await runIngestion(data);
  };

  const onDrop = useCallback(e => { e.preventDefault(); setDragOver(false); readFiles(e.dataTransfer.files); }, [docs]);

  const send = async () => {
    if (!input.trim() || loading || docs.length === 0) return;
    const userText = input.trim();
    setInput("");
    setMessages(p => [...p, { id: Date.now()+"u", role: "user", content: userText }]);
    setLoading(true);
    try {
      const sys = getSystemPrompt(role, scenarioMode, buildDocContext(docs));
      const newHistory = [...history, {
        role: "user",
        content: scenarioMode ? `SCENARIO COMPLIANCE AUDIT REQUEST:\n${userText}` : userText
      }];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, system: sys, messages: newHistory })
      });
      if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t.slice(0,200)}`); }
      const data = await res.json();
      const raw = (data.content || []).map(b => b.text || "").join("").trim();
      const parsed = safeParse(raw);
      setHistory([...newHistory, { role: "assistant", content: raw }]);
      setMessages(p => [...p, { id: Date.now()+"a", role: "assistant", persona: role, ...parsed }]);
    } catch (e) {
      setMessages(p => [...p, { id: Date.now()+"e", role: "assistant", persona: role, answer: `⚠️ ${e.message}`, warnings:[], citations:[], forms:[], complianceChecklist:[] }]);
    }
    setLoading(false);
  };

  const simplify = async (id, answer) => {
    setSimplifying(p => ({ ...p, [id]: true }));
    setSimplified(prev => ({ ...prev, [id]: null }));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 800,
          system: `You are a translator. You MUST respond with ONLY a raw JSON object. No markdown, no backticks, no explanation. First character must be { and last must be }. Schema: {"plainEnglish":"string","tagalog":"string"}`,
          messages: [{ role: "user", content: `Rewrite the following text in two ways:\n1. plainEnglish: simple, conversational English anyone can understand\n2. tagalog: natural Filipino/Tagalog translation\n\nText to rewrite:\n${answer}` }]
        })
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const raw = (data.content || []).map(b => b.text || "").join("").trim();
      const p = extractJSON(raw);
      if (p && p.plainEnglish && p.tagalog) {
        setSimplified(prev => ({ ...prev, [id]: p }));
      } else {
        // fallback: split raw into two if JSON failed but text came back
        setSimplified(prev => ({ ...prev, [id]: { plainEnglish: raw || "Could not simplify.", tagalog: "Subukan muli." } }));
      }
    } catch (e) {
      setSimplified(prev => ({ ...prev, [id]: { plainEnglish: `Error: ${e.message}`, tagalog: "Hindi ma-simplify. Subukan muli." } }));
    }
    setSimplifying(p => ({ ...p, [id]: false }));
  };

  const RoleBadge = ({ r }) => (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-bold"
      style={{ background: ROLE_COLORS[r]?.bg, color: ROLE_COLORS[r]?.color }}>{r}</span>
  );

  const AssistantBubble = ({ msg }) => (
    <div className="max-w-2xl w-full">
      <div className="flex items-center gap-2 mb-1">
        <BotAvatar size={6} />
        <span className="text-xs text-gray-400 font-medium">DAP Policy Assistant</span>
        {msg.persona && <RoleBadge r={msg.persona} />}
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm p-4">
        {msg.warnings?.map((w,i) => (
          <div key={i} className="mb-3 p-3 rounded-xl border border-yellow-300 bg-yellow-50">
            <p className="text-xs font-bold text-yellow-800">⚠️ Policy Amendment Warning</p>
            <p className="text-xs text-yellow-700 mt-0.5">The <strong>{w.year}</strong> rule was amended by <strong>{w.amendedBy}</strong>.</p>
          </div>
        ))}

        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{msg.answer}</p>

        {msg.complianceChecklist?.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-gray-600">📋 Compliance Checklist</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "#EEF0FC", color: DAP_BLUE }}>{msg.complianceChecklist.length} rules</span>
            </div>
            <div className="space-y-2">
              {msg.complianceChecklist.map((item, i) => (
                <label key={i} className="flex items-start gap-2 cursor-pointer group">
                  <input type="checkbox" defaultChecked={item.applicable} className="mt-0.5 flex-shrink-0 accent-blue-700" />
                  <div>
                    <span className="text-xs text-gray-700">{item.rule}</span>
                    {item.source && <span className="text-xs text-gray-400 ml-1">— {item.source}</span>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {msg.forms?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {msg.forms.map((f,i) => (
              <button key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border hover:opacity-75"
                style={{ background: "#F4F5FD", color: DAP_BLUE, borderColor: "#C5C9EF" }}>
                📄 Download {f.name}
              </button>
            ))}
          </div>
        )}

        {msg.citations?.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <p className="text-xs font-bold text-gray-400 mb-1.5">Sources</p>
            <div className="space-y-1.5">
              {msg.citations.map((c,i) => <CitationLink key={i} c={c} docs={docs} onOpen={setPdfViewer} />)}
            </div>
          </div>
        )}

        <div className="mt-3 border-t pt-2">
          <button onClick={() => simplify(msg.id, msg.answer)} disabled={simplifying[msg.id]}
            className="text-xs font-semibold hover:underline disabled:opacity-40" style={{ color: DAP_GOLD }}>
            {simplifying[msg.id] ? "⏳ Translating..." : "🔤 Simplify / Tagalog"}
          </button>
          {simplified[msg.id] && (
            <div className="mt-2 p-3 rounded-xl border border-green-200 bg-green-50 space-y-2">
              <div>
                <p className="text-xs font-bold text-green-700">Plain English</p>
                <p className="text-xs text-green-900 mt-0.5">{simplified[msg.id].plainEnglish}</p>
              </div>
              <div className="border-t border-green-200 pt-2">
                <p className="text-xs font-bold text-green-700">Filipino / Tagalog</p>
                <p className="text-xs text-green-900 mt-0.5">{simplified[msg.id].tagalog}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif" }} className="flex flex-col h-screen bg-gray-50">
      {/* Nav */}
      <nav className="flex items-center px-6 shadow-md z-10 flex-shrink-0" style={{ background: DAP_BLUE, minHeight: 58 }}>
        <div className="flex items-center gap-3 mr-8">
          <HeaderLogo />
          <div className="border-l border-blue-500 pl-3">
            <div className="text-white font-bold text-sm leading-tight">Policy Assistant</div>
            <div className="text-xs leading-tight" style={{ color: DAP_GOLD }}>Development Academy of the Philippines</div>
          </div>
        </div>
        <div className="flex gap-1">
          {[["chat","💬 Chat Interface"],["admin","⚙️ Admin Panel"]].map(([t,label]) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-4 text-sm font-medium border-b-2 transition-colors"
              style={{ borderColor: tab===t ? DAP_GOLD : "transparent", color: tab===t ? "white" : "rgba(255,255,255,0.6)" }}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs" style={{ color: DAP_GOLD }}>{docs.length} doc{docs.length!==1?"s":""} indexed</div>
      </nav>

      {tab === "chat" ? (
        <div className="flex flex-1 overflow-hidden relative">
          {/* Sidebar */}
          <div className="bg-white border-r border-gray-200 flex-shrink-0 overflow-hidden transition-all duration-300" style={{ width: sidebarOpen ? 240 : 0 }}>
            <div className="p-4 overflow-y-auto min-w-[240px]">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Configuration</p>
              <div className="mb-5">
                <label className="block text-xs font-semibold text-gray-600 mb-1">User Role</label>
                <select value={role} onChange={e => { setRole(e.target.value); setHistory([]); }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">AI tailors answers to this role.</p>
              </div>
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-600">Scenario Mode</label>
                  <button onClick={() => setScenarioMode(p => !p)}
                    className="relative w-10 h-5 rounded-full transition-colors"
                    style={{ background: scenarioMode ? DAP_BLUE : "#d1d5db" }}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${scenarioMode ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <p className="text-xs text-gray-400">Generates compliance checklists.</p>
              </div>
              <div className="p-3 rounded-xl mb-3 border" style={{ background: "#F4F5FD", borderColor: "#C5C9EF" }}>
                <p className="text-xs font-semibold text-gray-500 mb-1">Active Persona</p>
                <RoleBadge r={role} />
              </div>
              {docs.length === 0 ? (
                <div className="p-3 rounded-xl border border-yellow-200 bg-yellow-50">
                  <p className="text-xs text-yellow-700">⚠️ No documents uploaded yet.</p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">Indexed Docs ({docs.length})</p>
                  {docs.map((d,i) => (
                    <button key={i} onClick={() => setPdfViewer(d)}
                      className="w-full text-left text-xs py-1 border-b border-gray-100 truncate hover:underline block"
                      style={{ color: DAP_BLUE }} title={d.name}>📄 {d.name}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button onClick={() => setSidebarOpen(p => !p)}
            className="absolute top-1/2 -translate-y-1/2 z-20 text-white w-5 h-10 rounded-r flex items-center justify-center text-xs shadow"
            style={{ left: sidebarOpen ? 240 : 0, background: DAP_BLUE }}>
            {sidebarOpen ? "‹" : "›"}
          </button>

          {/* Chat */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role==="user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "user"
                    ? <div className="max-w-lg text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow" style={{ background: DAP_BLUE }}>{msg.content}</div>
                    : <AssistantBubble msg={msg} />
                  }
                </div>
              ))}
              {loading && (
                <div className="flex justify-start items-start gap-2">
                  <BotAvatar size={6} />
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm px-5 py-4 ml-1">
                    <div className="flex gap-1 items-center">
                      {[0,1,2].map(i=><div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{background:DAP_BLUE,animationDelay:`${i*0.15}s`}}/>)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t bg-white p-4 flex-shrink-0">
              {scenarioMode && (
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: DAP_BLUE, color: "white" }}>SCENARIO MODE</span>
                  <span className="text-xs text-gray-500">Describe your project or event for a compliance audit</span>
                </div>
              )}
              <div className="flex gap-3 items-end">
                {scenarioMode ? (
                  <textarea value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key==="Enter" && e.ctrlKey) send(); }}
                    placeholder="Describe your scenario in detail..."
                    className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2" rows={4} />
                ) : (
                  <input value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key==="Enter") send(); }}
                    placeholder={docs.length===0 ? "Upload documents in Admin Panel first..." : "Ask about DAP policies..."}
                    disabled={docs.length===0}
                    className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2" />
                )}
                <button onClick={send} disabled={loading||!input.trim()||docs.length===0}
                  className="px-5 py-3 text-white rounded-xl text-sm font-bold disabled:opacity-40 hover:opacity-90 flex-shrink-0"
                  style={{ background: DAP_BLUE }}>
                  {scenarioMode ? "Audit" : "Send"}
                </button>
              </div>
              {scenarioMode && <p className="text-xs text-gray-400 mt-1">Ctrl + Enter to submit</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto">
            <div className="mb-6 flex items-center gap-3 border-b pb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: DAP_BLUE }}>⚙️</div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">Admin Panel — Document Ingestion</h2>
                <p className="text-sm text-gray-500">Upload DAP policy PDFs. The chatbot answers <strong>exclusively</strong> from these documents.</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
              <h3 className="text-sm font-bold mb-3" style={{ color: DAP_BLUE }}>📤 Upload Policy Documents (PDF)</h3>
              <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
                onDrop={onDrop} onClick={()=>!ingesting&&fileRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all"
                style={{ borderColor: dragOver?DAP_BLUE:"#D1D5DB", background: dragOver?"#F4F5FD":"#FAFAFA" }}>
                <div className="text-5xl mb-3">📁</div>
                <p className="text-sm font-semibold text-gray-700">Drag & drop PDFs here, or <span style={{color:DAP_BLUE}}>click to browse</span></p>
                <p className="text-xs text-gray-400 mt-2">Multiple PDFs supported • Text extracted locally in browser</p>
                <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden"
                  onChange={e=>{readFiles(e.target.files);e.target.value="";}} />
              </div>
              {ingestError && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200"><p className="text-xs text-red-700">⚠️ {ingestError}</p></div>}
            </div>

            {ingesting && (
              <div className="bg-white rounded-2xl border shadow-sm p-6 mb-6" style={{ borderColor: "#C5C9EF" }}>
                <h3 className="text-sm font-bold mb-1" style={{ color: DAP_BLUE }}>Processing: <span className="font-normal">{ingestFileName}</span></h3>
                <p className="text-xs text-gray-400 mb-4">Indexing document into knowledge base...</p>
                <div className="grid grid-cols-4 gap-3">
                  {INGEST_STEPS.map((step,i) => (
                    <div key={step} className="text-center">
                      <div className="h-2 rounded-full mb-2 transition-all duration-500"
                        style={{ background: i<ingestStep?"#16a34a":i===ingestStep?DAP_BLUE:"#E5E7EB" }} />
                      <p className="text-xs font-medium" style={{ color: i<ingestStep?"#16a34a":i===ingestStep?DAP_BLUE:"#9CA3AF" }}>
                        {i<ingestStep?"✓ ":i===ingestStep?"⏳ ":""}{step}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-700">📚 Currently Indexed Policies</h3>
                {docs.length>0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-800">✓ {docs.length} document{docs.length!==1?"s":""} indexed</span>}
              </div>
              {docs.length===0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-3">📭</div>
                  <p className="text-sm text-gray-400">No documents indexed yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["Document Name","Date","Size","Chars Extracted","Status","Action"].map(h=>(
                        <th key={h} className="pb-3 text-left text-xs font-bold text-gray-400 uppercase tracking-wide pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d,i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-3 pr-4 max-w-[180px]">
                          <button onClick={()=>setPdfViewer(d)} className="text-xs font-medium hover:underline truncate block text-left" style={{color:DAP_BLUE}} title={d.name}>📄 {d.name}</button>
                        </td>
                        <td className="py-3 pr-4 text-gray-500 text-xs">{d.date}</td>
                        <td className="py-3 pr-4 text-gray-500 text-xs">{d.size}</td>
                        <td className="py-3 pr-4 text-gray-500 text-xs">{d.text?.length?.toLocaleString()}</td>
                        <td className="py-3 pr-4"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">✓ Indexed</span></td>
                        <td className="py-3">
                          <button onClick={()=>{setDocs(p=>p.filter((_,j)=>j!==i));setHistory([]);}} className="text-xs text-red-400 hover:text-red-600 hover:underline">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {pdfViewer && <PdfViewerModal doc={pdfViewer} onClose={()=>setPdfViewer(null)} />}
    </div>
  );
}
