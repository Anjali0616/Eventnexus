// Lightweight lexicon-based sentiment scorer — no external ML service
// required, so feedback always gets scored even with no AI keys configured.
// If GROQ/GEMINI is configured, the score is refined with a one-word LLM
// classification (see refineWithAI), the same optional-enhancement pattern
// aiProvider.js already uses for the chatbot.
export const POSITIVE_WORDS: string[] = [
  "great", "amazing", "excellent", "awesome", "good", "love", "loved",
  "fantastic", "wonderful", "helpful", "smooth", "enjoyed", "enjoyable",
  "informative", "engaging", "well organized", "well-organized", "perfect",
  "best", "nice", "fun", "insightful", "impressive", "recommend", "happy",
  "outstanding", "brilliant", "useful", "clean", "professional", "friendly",
];

export const NEGATIVE_WORDS: string[] = [
  "bad", "terrible", "awful", "poor", "worst", "disappointing", "disappointed",
  "boring", "late", "delayed", "confusing", "messy", "unorganized",
  "disorganized", "rude", "waste", "crowded", "overpriced", "hate", "hated",
  "problem", "issue", "broken", "slow", "cancelled", "canceled", "refund",
  "unhelpful", "annoying", "frustrating", "disaster",
];

export const scoreFromText = (text: string | null | undefined): number => {
  const normalized = (text || "").toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) {
    if (normalized.includes(word)) score += 1;
  }
  for (const word of NEGATIVE_WORDS) {
    if (normalized.includes(word)) score -= 1;
  }
  return score;
};

// Combines the star rating with the lexicon score on the comment text —
// rating dominates when a comment is short/empty, text can shift a
// borderline rating in either direction.
export const classifySentiment = ({ rating, comment }: { rating: number; comment?: string | null }): { sentiment: string; sentimentScore: number } => {
  const textScore = scoreFromText(comment);
  const ratingScore = rating - 3; // -2..2, centered on a neutral 3-star

  const combined = ratingScore + Math.sign(textScore) * Math.min(Math.abs(textScore), 2);
  const normalizedScore = Math.max(-1, Math.min(1, combined / 4));

  let sentiment = "neutral";
  if (normalizedScore > 0.2) sentiment = "positive";
  else if (normalizedScore < -0.2) sentiment = "negative";

  return { sentiment, sentimentScore: Math.round(normalizedScore * 100) / 100 };
};

export default { classifySentiment, scoreFromText, POSITIVE_WORDS, NEGATIVE_WORDS };
