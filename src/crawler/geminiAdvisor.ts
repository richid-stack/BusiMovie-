/**
 * The AI "eye": consulted only when the rules cannot choose a button. It sees the screen as text,
 * suggests a button index, and its suggestion is still safety-checked by the navigator and the
 * downloaded file is still verified, so a wrong guess cannot store a wrong film.
 */
import { GoogleGenAI } from "@google/genai";
import type { Advisor, AdvisorDecision, Goal } from "./navigator.js";
import type { Screen } from "./screen.js";

let client: GoogleGenAI | null = null;
const MODELS = () => [process.env.GEMINI_MODEL, "gemini-flash-latest"].filter(Boolean) as string[];

export const geminiAdvisor: Advisor = {
  async decide(screen: Screen, goal: Goal): Promise<AdvisorDecision | null> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    client ??= new GoogleGenAI({ apiKey: key });
    const want =
      goal.kind === "movie" ? `the movie "${goal.title}"${goal.year ? ` (${goal.year})` : ""}`
      : `the TV series "${goal.title}"${goal.season ? ` season ${goal.season}` : ""}${goal.episode ? ` episode ${goal.episode}` : ""}`;
    const prompt =
      `A Telegram bot is showing this screen. We want ${want}.\n\nScreen text:\n${screen.text.slice(0, 800)}\n\nButtons (index: label):\n` +
      screen.buttons.map((b, i) => `${i}: ${b.text}`).join("\n").slice(0, 2500) +
      `\n\nReply with JSON only: {"action":"click"|"next_page"|"give_up","buttonIndex":number,"why":"short"}. ` +
      `Pick "click" only if a button clearly is the wanted title (right year/part/season). Never pick Back, ads, or join links. If unsure, "give_up".`;
    for (const model of MODELS()) {
      try {
        const res = await client.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json", temperature: 0 } });
        const j = JSON.parse(res.text || "{}");
        if (j.action === "click" && Number.isInteger(j.buttonIndex)) return { action: "click", buttonIndex: j.buttonIndex, why: String(j.why || "").slice(0, 120) };
        if (j.action === "next_page") return { action: "next_page", why: String(j.why || "").slice(0, 120) };
        return { action: "give_up", why: String(j.why || "").slice(0, 120) };
      } catch { /* try next model */ }
    }
    return null;
  },
};
