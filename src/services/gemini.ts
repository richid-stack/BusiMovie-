import { GoogleGenAI } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

// Supported models with automatic fallback on temporary high demand (503)
// Override with GEMINI_MODEL; the "-latest" aliases always resolve to a current model.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODELS = ["gemini-flash-lite-latest"];

async function executeGeminiWithFallback<T>(
  operation: (modelName: string) => Promise<T>
): Promise<T> {
  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      return await operation(model);
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.warn(`[Gemini] Model ${model} failed (${errMsg.substring(0, 100)}). Trying fallback...`);
    }
  }

  throw lastError;
}

export interface AIRecommendationResult {
  recommendation: string;
  suggestedTitles: string[];
  explanation: string;
}

// --- Phase 6: BusiMovie Core AI Intent Router ---

export type BusiMovieIntent = 
  | "request_media" 
  | "search_library" 
  | "recommend_content" 
  | "check_status" 
  | "general_chat";

export interface ParsedIntent {
  intent: BusiMovieIntent;
  mediaTitle?: string;
  mediaType?: "movie" | "tv";
  confidence: number;
  aiResponse: string; // The natural language response to the user
}

// Quick conversational check for greetings and system questions
function checkHeuristicIntent(text: string): ParsedIntent | null {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // Greetings and chit-chat
  if (/^(hi|hello|hey|yo|greetings|hola|sup|good\s*(morning|afternoon|evening)|who\s*are\s*you|help|what\s*can\s*you\s*do|start)$/i.test(lower)) {
    return {
      intent: "general_chat",
      mediaTitle: undefined,
      confidence: 0.95,
      aiResponse: "Hello! 👋 I am your BusiMovie AI cinema concierge.\n\nHere is what I can do for you:\n• 🎬 <b>Search:</b> Type any movie or TV series name (e.g. <i>Inception</i>, <i>Breaking Bad</i>)\n• 🍿 <b>Recommend:</b> Ask me for ideas (e.g. <i>Recommend a 90s action thriller</i>)\n• 🎲 <b>Explore:</b> Use /random or ask for a surprise pick"
    };
  }

  // Explicit recommendations request
  if (/^(recommend|suggest|what should i watch|give me a movie|find something like)/i.test(lower)) {
    return {
      intent: "recommend_content",
      mediaTitle: undefined,
      confidence: 0.9,
      aiResponse: "Let me find some great movie recommendations for you!"
    };
  }

  // Explicit requests to add/download
  const reqMatch = lower.match(/^(?:please\s+)?(?:can\s+you\s+)?(?:request|download|add|get)\s+(.+)$/i);
  if (reqMatch && reqMatch[1]) {
    return {
      intent: "request_media",
      mediaTitle: reqMatch[1].trim(),
      confidence: 0.9,
      aiResponse: `Understood! Let's check for "${reqMatch[1].trim()}" in our providers.`
    };
  }

  return null;
}

/**
 * The core BusiMovie AI layer described in the architecture document.
 * This determines WHAT the user wants to do, passing structured data to the backend.
 */
export async function analyzeUserIntent(
  userText: string,
  context: string = ""
): Promise<ParsedIntent> {
  const ai = getAIClient();
  const cleanQuery = userText.trim();
  
  if (!ai) {
    const heuristic = checkHeuristicIntent(cleanQuery);
    if (heuristic) return heuristic;
    return {
      intent: "search_library",
      mediaTitle: cleanQuery,
      confidence: 0.8,
      aiResponse: ""
    };
  }

  try {
    const prompt = `You are the core intelligence layer of BusiMovie, an advanced Telegram media automation system.
Your job is to analyze the user's natural language request and determine their intent, extracting any relevant media titles.

Possible Intents:
- "general_chat": Conversational chit-chat, greetings (e.g. "hi", "hello", "hey", "how are you"), questions about your identity or what you can do, or general remarks where NO movie title was requested.
- "request_media": The user wants to download, add, or acquire a new movie or TV show. (e.g. "Add Dune", "Get the latest season of Breaking Bad")
- "search_library": The user wants to find, stream, or check if they have a specific movie/show title. (e.g. "Do we have Interstellar?", "Inception", "Show me Gladiator")
- "recommend_content": The user is asking for suggestions based on mood, genre, or similarities. (e.g. "Find something like Interstellar", "Funny movie for tonight")
- "check_status": The user is asking if a requested download is finished. (e.g. "Is Dune ready yet?", "Status of my downloads")

CRITICAL: If the user simply says "hi", "hello", "hey", "who are you", etc., intent MUST be "general_chat" and mediaTitle MUST be null!

Context provided from the system: ${context || "None"}

User Request: "${userText}"

Respond ONLY with a valid JSON object matching this schema:
{
  "intent": "request_media" | "search_library" | "recommend_content" | "check_status" | "general_chat",
  "mediaTitle": "Extracted title if applicable, or null",
  "mediaType": "movie" | "tv" | null,
  "confidence": 0.0 to 1.0,
  "aiResponse": "A natural, warm response addressing the user. If greeting, welcome them and invite them to search or ask for recommendations."
}`;

    const parsedResult = await executeGeminiWithFallback(async (modelName) => {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      const text = response.text || "{}";
      return JSON.parse(text);
    });
    
    return {
      intent: parsedResult.intent || "general_chat",
      mediaTitle: parsedResult.mediaTitle || undefined,
      mediaType: parsedResult.mediaType || undefined,
      confidence: typeof parsedResult.confidence === "number" ? parsedResult.confidence : 0.8,
      aiResponse: parsedResult.aiResponse || "How can I help you with movies today?"
    };

  } catch (err: any) {
    console.error("Intent parsing error across all Gemini models:", err?.message || err);
    // Use intelligent fallback rather than assuming everything is a movie title
    const heuristic = checkHeuristicIntent(cleanQuery);
    if (heuristic) {
      return heuristic;
    }

    return {
      intent: "search_library",
      mediaTitle: cleanQuery,
      confidence: 0.85,
      aiResponse: ""
    };
  }
}

// ------------------------------------------------

export async function getAIMovieRecommendations(
  userPrompt: string,
  availableVaultTitles: string[] = []
): Promise<AIRecommendationResult> {
  const ai = getAIClient();
  if (!ai) {
    const sample = availableVaultTitles.slice(0, 3);
    return {
      recommendation: `Here are some recommendations based on your library: ${sample.join(", ") || "The Fall Guy, Dune: Part Two, Furiosa"}.`,
      suggestedTitles: sample.length > 0 ? sample : ["Dune: Part Two", "Interstellar", "Inception"],
      explanation: "Default library titles."
    };
  }

  try {
    const vaultContext = availableVaultTitles.length > 0
      ? `Currently in the BusiMovie catalog: [${availableVaultTitles.join(", ")}]. If any of these fit the prompt, prioritize highlighting them!`
      : "BusiMovie has an extensive cinema library.";

    const prompt = `You are an expert movie recommender and cinema concierge for BusiMovie.
User Request: "${userPrompt}"
${vaultContext}

Please suggest 3 to 5 matching movies or TV shows. For each title, provide:
1. Title and release year
2. Why it matches the user's mood/taste
3. Indicate whether it is currently available in the BusiMovie catalog.

Format your response clearly. Also at the very end, include a comma-separated list of the clean movie titles on a single line starting with "TITLES: " (e.g. TITLES: Inception, Interstellar, The Dark Knight).`;

    const response = await executeGeminiWithFallback(async (modelName) => {
      return await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });
    });

    const text = response.text || "No recommendations generated.";
    
    // Parse TITLES line
    const titlesMatch = text.match(/TITLES:\s*(.*)$/im);
    let suggestedTitles: string[] = [];
    if (titlesMatch && titlesMatch[1]) {
      suggestedTitles = titlesMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else {
      suggestedTitles = availableVaultTitles.slice(0, 3);
    }

    const cleanRecommendation = text.replace(/TITLES:\s*.*$/im, "").trim();

    return {
      recommendation: cleanRecommendation,
      suggestedTitles,
      explanation: "Powered by Gemini"
    };
  } catch (error: any) {
    console.error("Gemini recommendation error across all models:", error?.message || error);
    return {
      recommendation: `Couldn't generate AI recommendations right now (${error?.message || "Service error"}).`,
      suggestedTitles: availableVaultTitles.slice(0, 3),
      explanation: "Error contacting Gemini API"
    };
  }
}

/**
 * Generates an engaging, cinephile follow-up notification or question
 * after a user watches or streams a movie from the Vault.
 */
export async function generateMoviePostWatchFollowUp(
  movieTitle: string,
  year?: string
): Promise<{ headline: string; question: string; funFact: string }> {
  const fallback = {
    headline: `Hope you enjoyed ${movieTitle}! 🍿`,
    question: "How would you rate it out of 10, or did that ending catch you by surprise?",
    funFact: "Check out the Vault library for similar high-voltage movies and hidden cinema gems!"
  };

  const ai = getAIClient();
  if (!ai) return fallback;

  try {
    const prompt = `You are an engaging, witty cinema concierge for a Telegram Movie community.
A user just downloaded or streamed the movie "${movieTitle}" ${year ? `(${year})` : ""}.
Generate a captivating, brief post-watch follow-up (30-40 words total) in JSON format:
{
  "headline": "A catchy 1-line reaction to this specific movie",
  "question": "An intriguing question about the plot, moral dilemma, or performance",
  "funFact": "One mind-blowing behind-the-scenes trivia fact about this movie"
}
Output only pure JSON.`;

    const response = await executeGeminiWithFallback(async (modelName) => {
      return await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
    });

    const parsed = JSON.parse(response.text || "{}");
    return {
      headline: parsed.headline || fallback.headline,
      question: parsed.question || fallback.question,
      funFact: parsed.funFact || fallback.funFact
    };
  } catch (e) {
    console.warn("Follow-up generation fallback used:", e);
    return fallback;
  }
}


// --- Find a title from what a viewer remembers: a description, a voice note, or a poster/screenshot ---
export interface IdentifiedTitle { title: string; year?: string; kind?: "movie" | "tv" }
export interface IdentifyResult { heard?: string; titles: IdentifiedTitle[] }
export interface IdentifyInput { text?: string; media?: { data: Buffer; mime: string } }

/** Pure: Gemini's JSON (maybe fenced, maybe sloppy) → a clean, short list. Exported for tests. */
export function parseIdentifyJson(raw: string): IdentifyResult {
  let t = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return { titles: [] };
  let j: any;
  try { j = JSON.parse(t.slice(start, end + 1)); } catch { return { titles: [] }; }
  const seen = new Set<string>();
  const titles: IdentifiedTitle[] = [];
  for (const x of Array.isArray(j.titles) ? j.titles : []) {
    const title = String(x?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
    if (title.length < 2 || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const y = String(x?.year ?? "").match(/\b(19|20)\d{2}\b/);
    titles.push({ title, year: y ? y[0] : undefined, kind: x?.kind === "tv" || x?.kind === "series" ? "tv" : "movie" });
    if (titles.length >= 5) break;
  }
  const heard = typeof j.heard === "string" && j.heard.trim() ? j.heard.trim().slice(0, 300) : undefined;
  return heard ? { heard, titles } : { titles };
}

export function aiFinderAvailable(): boolean { return !!process.env.GEMINI_API_KEY; }

export async function identifyTitles(input: IdentifyInput): Promise<IdentifyResult | null> {
  const ai = getAIClient();
  if (!ai) return null;
  const what = input.media?.mime.startsWith("audio/") ? "a voice note in which someone describes or names a movie or TV series (transcribe what they asked for in \"heard\")"
    : input.media ? "a poster, screenshot or still from a movie or TV series"
    : "a description of a movie or TV series someone is trying to remember";
  const prompt = `You help people find movies and TV series. Input: ${what}.${input.text ? `\n\nDescription: """${input.text.slice(0, 600)}"""` : ""}\n\n` +
    `Reply with JSON only: {"heard":"short transcript or what you understood","titles":[{"title":"official title","year":"YYYY","kind":"movie"|"tv"}]}. ` +
    `Give up to 4 of the most likely titles, best first. Only real, released titles. If you can't tell, return an empty list. Never invent a title.`;
  const parts: any[] = [{ text: prompt }];
  if (input.media) parts.push({ inlineData: { mimeType: input.media.mime, data: input.media.data.toString("base64") } });
  const res = await executeGeminiWithFallback((model) => ai.models.generateContent({ model, contents: [{ role: "user", parts }], config: { responseMimeType: "application/json", temperature: 0.2 } }));
  return parseIdentifyJson(res.text || "");
}
