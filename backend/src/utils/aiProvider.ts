// Gemini is the primary provider, Groq the fallback. Gemini (gemini-2.5-flash)
// gives better instruction-following for structured replies (markdown tables,
// links); Groq covers it with low latency if Gemini is down or unset.
const GROQ_API_KEY: string | undefined = process.env.GROQ_API_KEY;
const GROQ_MODEL: string = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const GEMINI_API_KEY: string | undefined = process.env.GEMINI_API_KEY;
const GEMINI_MODEL: string = process.env.GEMINI_MODEL || "gemini-flash-latest";

const TIMEOUT_MS: number = 10000
const MAX_RETRIES: number = 2

const fetchWithTimeout = async (url: string, options: any): Promise<any> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const callGroq = async (messages: any[]): Promise<string | null> => {
  if (!GROQ_API_KEY) return null;
  const res: any = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 700,
      top_p: 0.9,
    }),
  });
  if (!res.ok) throw new Error(`Groq responded ${res.status}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
};

const callGemini = async (messages: any[]): Promise<string | null> => {
  if (!GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  // Gemini's API takes contents as alternating role parts; fold the system
  // prompt into the first user turn (Gemini has no system role in v1beta).
  const contents: any[] = messages.map((m: any) => ({
    role: m.role === "system" ? "user" : m.role,
    parts: [{ text: m.content }],
  }));
  if (messages[0]?.role === "system") {
    // Fold system prompt into the first user turn, then drop the original
    // first user message so nothing is duplicated: [system, user, ...] -> [user(system+user), ...]
    contents[0].parts = [{ text: `${messages[0].content}\n\n${messages[1]?.content ?? ""}` }];
    contents.splice(1, 1);
  }
  const res: any = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 700,
        topP: 0.9,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini responded ${res.status}`);
  const data: any = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
};

// Gemini first (primary), Groq second (fallback) — see header comment.
const PROVIDERS: Array<{ name: string; call: (messages: any[]) => Promise<string | null> }> = [
  { name: "gemini", call: callGemini },
  { name: "groq", call: callGroq },
];

// history: optional [{ role: "user" | "assistant", content }] so the model
// sees the conversation so far (context), not just the latest message.
export const generateReply = async (systemPrompt: string, userPrompt: string, history: any[] = []): Promise<string | null> => {
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h: any) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content })),
    { role: "user", content: userPrompt },
  ];
  for (const provider of PROVIDERS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const reply = await provider.call(messages);
        if (reply) return reply;
      } catch (error: any) {
        console.error(`[ai] ${provider.name} attempt ${attempt + 1} failed: ${error.message}`);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
  }
  return null;
};

export const generateEventInsight = async (event: any): Promise<string | null> => {
  const systemPrompt =
    "You are EventNexus AI, an event analytics assistant. " +
    "Generate a concise, data-driven insight (1-2 sentences) about the event's current demand and registration trends. " +
    "Use ONLY the facts provided. Be precise and helpful. Never invent data.";

  const userPrompt = [
    "Event:", event.title,
    "Category:", event.category,
    "Type:", event.type,
    "Capacity:", event.capacity,
    "Registered:", event.registered,
    "Status:", event.status,
    "Days until event:", event.daysUntil,
  ].join("\n");

  return generateReply(systemPrompt, userPrompt);
};

// AI-assisted event draft generation for organizers — creates compelling
// description, highlights, tags, and suggested agenda from minimal input.
// Falls back to heuristic template if LLM unavailable; never blocks creation.
export const generateEventDraft = async ({ title, category, type, venue, capacity }: {
  title: string;
  category: string;
  type: string;
  venue?: string;
  capacity?: number;
}): Promise<any | null> => {
  const systemPrompt =
    "You are EventNexus AI, an expert event copywriter. Given minimal event info, " +
    "generate engaging, attendee-focused content in STRICT JSON only. Respond with ONLY a JSON object " +
    "with keys: description (2-3 sentences, 40-60 words, compelling), highlights (array of 3 short bullet strings), " +
    "tags (array of 3 relevant lowercase tags), agenda (array of 2-3 objects with time,title,description), " +
    "requirements (one short sentence), refundPolicy (one sentence). Never add extra keys or markdown.";

  const userPrompt = [
    `Title: ${title}`,
    `Category: ${category}`,
    `Type: ${type}`,
    `Venue: ${venue || "TBA"}`,
    `Capacity: ${capacity || 100}`,
  ].join("\n");

  const raw = await generateReply(systemPrompt, userPrompt);
  if (!raw) return null;
  // Extract JSON block if LLM wrapped in fences
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed: any = JSON.parse(match[0]);
    // Validate shape
    if (!parsed.description || !Array.isArray(parsed.highlights)) return null;
    return {
      description: String(parsed.description).slice(0, 600),
      highlights: parsed.highlights.slice(0, 5).map(String),
      tags: parsed.tags ? parsed.tags.slice(0, 5).map((t: any) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20)).filter(Boolean) : [],
      agenda: Array.isArray(parsed.agenda) ? parsed.agenda.slice(0, 4) : [],
      requirements: parsed.requirements ? String(parsed.requirements).slice(0, 200) : "",
      refundPolicy: parsed.refundPolicy ? String(parsed.refundPolicy).slice(0, 200) : "",
    };
  } catch {
    return null;
  }
};

export default { generateReply, generateEventInsight, generateEventDraft };
