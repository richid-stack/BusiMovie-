import { analyzeUserIntent } from "./src/services/gemini.js";
analyzeUserIntent("Inception").then(res => console.log(res)).catch(err => console.error(err));
