import stringSimilarity from "string-similarity";

export interface CandidateButton {
  text: string;
  row: number;
  col: number;
  data?: string;
  url?: string;
  isDownload?: boolean;
}

/**
 * Checks whether a button is a Back, Return, Navigation, Close, or Ad button.
 */
export function isBackOrNavButton(text: string): boolean {
  if (!text) return true;
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/^\d+\s*\/\s*\d+$/.test(t)) return true; // pagination e.g. 1/5
  if (/^[\W_]*(?:<<|>>|<|>|‹|›|«|»|◀️?|▶️?|⏪|⏩|⬅️?|➡️?)[\W_]*(?:prev(?:ious)?|next|back)?[\W_]*$/i.test(t)) return true;
  if (/\b(?:page\s*\d+|p\.\d+|\d+\s*of\s*\d+)\b/i.test(t) && t.length < 16) return true;
  // Navigation words only count when they ARE the button, never when they are part of a film title
  // ("Home Alone", "Return of the Jedi", "Close Encounters", "Ad Astra" must stay selectable).
  if (/^[\W_]*(?:back|return|prev(?:ious)?|next|close|cancel|help|faq|support|main\s*menu|home|menu|rules|refresh|more|start\s*over|new\s*search)(?:\s+(?:to|page|menu|results?|search|list))*[\W_]*$/i.test(t)) return true;
  if (/\b(?:join\s+(?:our|the|this|private)\s*(?:telegram\s*)?(?:channel|group|vip)|join\s*@[\w_]+|telegram\s*@[\w_]+|follow\s*@[\w_]+)\b/i.test(t) || /^[\W_]*subscribe\b/i.test(t)) return true;
  if (/\b(?:crypto|earn\s*money|vpn|download\s*app|sponsor(?:ed)?)\b/i.test(t)) return true;
  if (/^[\W_]*(?:ads?|promo|direct\s*link)[\W_]*$/i.test(t)) return true;
  return false;
}

/**
 * Intelligent Semantic Decision Matcher for Crawler Button Selection:
 * Accurately scores button candidates based on Sequel/Part numbers, Release Year,
 * Quality hierarchy, and normalized token similarity — preventing Part 1 vs Part 2 mix-ups.
 */
export function selectBestMatchingButton(
  buttons: CandidateButton[] | undefined,
  targetTitle: string,
  targetYear?: string,
  requestedQuality: string = "1080p"
): CandidateButton | null {
  if (!buttons || buttons.length === 0) return null;

  // Filter out non-download/navigation/promo buttons
  const validButtons = buttons.filter(b => {
    if (isBackOrNavButton(b.text)) return false;
    if (b.url && !b.url.includes("t.me/")) return false; // external ad links
    return true;
  });

  // Never fall back to "whatever is first" — that is how wrong films get downloaded.
  if (validButtons.length === 0) return null;

  // Helper to extract sequel / part number (e.g. "Part 2", "2", "II", "Chapter 2")
  const cleanTarget = targetTitle.toLowerCase();
  const getSequelNum = (str: string): number | null => {
    // Sizes ("2.1 GB"), resolutions, episode tags and years are not sequel numbers
    const s = str.toLowerCase()
      .replace(/\d+(?:[.,]\d+)?\s*(?:gb|mb|kb|tb)\b/g, " ")
      .replace(/\b(?:2160|1080|720|480|360)p?\b/g, " ")
      .replace(/\bs\d{1,2}\s*e\d{1,3}\b/g, " ")
      .replace(/\b(?:19|20)\d{2}\b/g, " ");
    if (/\b(part\s*4|part\s*iv|chapter\s*4|vol\s*4|\b4\b|four)\b/i.test(s)) return 4;
    if (/\b(part\s*3|part\s*iii|chapter\s*3|vol\s*3|\b3\b|three)\b/i.test(s)) return 3;
    if (/\b(part\s*2|part\s*ii|chapter\s*2|vol\s*2|\b2\b|two)\b/i.test(s) && !/\b(20\d\d|19\d\d)\b/.test(s)) return 2;
    if (/\b(part\s*1|part\s*i|chapter\s*1|vol\s*1|\b1\b|one)\b/i.test(s) && !/\b(1080p|720p)\b/.test(s)) return 1;
    return null;
  };

  const targetSeq = getSequelNum(cleanTarget);
  const targetWords = cleanTarget
    .replace(/[\s._\-:,'&/()]+/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !["the", "and", "movie", "full", "hd", "v", "vs"].includes(w));

  let bestButton: CandidateButton | null = null;
  let highestScore = -Infinity;

  for (const btn of validButtons) {
    const btnText = btn.text.toLowerCase();
    let score = 0;

    // 1. Is it a download/stream button?
    if (btn.isDownload || /\b(1080p|720p|480p|4k|2160p|gb|mb|mkv|mp4|download|get|stream|watch)\b/i.test(btnText)) {
      score += 50;
    }

    // 2. Sequel / Part Matching (CRITICAL: strictly prevents Part 1 vs Part 2 vs Part 3 mix-ups)
    const btnSeq = getSequelNum(btnText);
    if (targetSeq !== null) {
      if (btnSeq === targetSeq) {
        score += 180; // Exact sequel match
      } else if (btnSeq !== null && btnSeq !== targetSeq) {
        score -= 300; // Wrong sequel/part
      } else {
        score -= 100; // Button missing sequel when target explicitly wanted one
      }
    } else {
      // Target had NO sequel number (e.g. "Dune" or "Inside Out"), penalize if button has "Part 2", "2", "Part 3"
      if (btnSeq !== null && btnSeq > 1) {
        score -= 200;
      }
    }

    // 3. Release Year Matching
    if (targetYear) {
      const yearMatch = btnText.match(/\b(19\d\d|20\d\d)\b/);
      if (yearMatch) {
        if (yearMatch[1] === targetYear) {
          score += 120; // Exact year match
        } else {
          score -= 60; // Mismatched year
        }
      }
    }

    // 4. Quality Matching Hierarchy
    const targetQ = (requestedQuality || "1080p").toLowerCase();
    if (btnText.includes(targetQ)) {
      score += 90;
    } else if (btnText.includes("1080p")) {
      score += 65;
    } else if (btnText.includes("720p")) {
      score += 45;
    } else if (btnText.includes("4k") || btnText.includes("2160p")) {
      score += 40;
    } else if (btnText.includes("480p")) {
      score += 20;
    }

    // 5. Token Overlap Score (handles 'Ford v Ferrari' matching 'Ford v. Ferrari 2019')
    const normBtnText = btnText.replace(/[\s._\-:,'&/()]+/g, " ");
    for (const tw of targetWords) {
      if (normBtnText.includes(tw)) {
        score += 30;
      }
    }

    // 6. Mathematical Sørensen-Dice String Similarity
    try {
      const diceSim = stringSimilarity.compareTwoStrings(cleanTarget, normBtnText);
      score += Math.round(diceSim * 120);
      if (diceSim < 0.15 && !btnText.includes(cleanTarget) && targetWords.every(tw => !normBtnText.includes(tw))) {
        score -= 250; // Penalize completely unrelated titles
      }
    } catch (_) {}

    // 7. Penalize samples / trailers / cams
    if (/\b(sample|trailer|preview|promo|cam|hdcam|telesync|ts|sample\.mkv)\b/i.test(btnText)) {
      score -= 500;
    }

    if (score > highestScore) {
      highestScore = score;
      bestButton = btn;
    }
  }

  if (!bestButton) return null;

  // Confidence gate: the winner must actually look like the requested title, unless every
  // candidate is a bare quality/size button ("1080p • 2.1 GB") where there is no title to compare.
  const bestNorm = bestButton.text.toLowerCase().replace(/[\s._\-:,'&/()]+/g, " ");
  const isBareDownload = /^[\W\d]*(?:(?:2160p|1080p|720p|480p|4k|uhd|hd|sd|gb|mb|kb|mkv|mp4|x26[45]|hevc|web[- ]?dl|bluray|download|get|stream|watch)[\W\d]*)+$/i.test(bestNorm);
  if (!isBareDownload) {
    const hits = targetWords.filter(tw => bestNorm.includes(tw)).length;
    const wordRatio = targetWords.length ? hits / targetWords.length : 0;
    let sim = 0;
    try { sim = stringSimilarity.compareTwoStrings(cleanTarget, bestNorm); } catch (_) {}
    if (wordRatio < 0.5 && sim < 0.35) return null;
    if (highestScore < 0) return null;
  }
  return bestButton;
}
