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
const PRIMARY_MODEL = "gemini-3.8-flash";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-latest"];

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
      aiResponse: "Hello! 👋 I am your Telegram Movie Vault AI concierge.\n\nHere is what I can do for you:\n• 🎬 <b>Search:</b> Type any movie or TV series name (e.g. <i>Inception</i>, <i>Breaking Bad</i>)\n• 🍿 <b>Recommend:</b> Ask me for ideas (e.g. <i>Recommend a 90s action thriller</i>)\n• 🎲 <b>Explore:</b> Use /random or ask for a surprise pick\n• 📥 <b>Vault Sync:</b> Forward any video file to add it to your cloud library"
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
      ? `Currently in the user's Telegram Movie Vault: [${availableVaultTitles.join(", ")}]. If any of these fit the prompt, prioritize highlighting them!`
      : "The user has an expanding Telegram movie library.";

    const prompt = `You are an expert movie recommender and cinema concierge for a Telegram Movie Bot.
User Request: "${userPrompt}"
${vaultContext}

Please suggest 3 to 5 matching movies or TV shows. For each title, provide:
1. Title and release year
2. Why it matches the user's mood/taste
3. Indicate whether it is currently available in the user's Vault.

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
