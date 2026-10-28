// Pure helper functions (no database, no Express) so they are easy to test.

const REVISION_INTERVALS = [1, 3, 7, 14, 30]; // days to wait for Leitner box 1..5
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// NEET style marking: +4 correct, -1 wrong, 0 unanswered
function calcMarks(selected, correct, marks = 4, negative = 1) {
  if (!selected) return 0;
  return selected === correct ? marks : -negative;
}

function percentOf(score, maxScore) {
  if (!maxScore || maxScore <= 0) return 0;
  return clamp(Math.round((score / maxScore) * 100), 0, 100);
}

function starsFor(percent, passPercent = 60) {
  if (percent < passPercent) return 0;
  if (percent >= 90) return 3;
  if (percent >= 75) return 2;
  return 1;
}

const levelFromXp = (xp) => Math.floor(xp / 100) + 1;

// Adaptive engine: right answer -> harder question, wrong answer -> easier question
const nextDifficulty = (current, isCorrect) => clamp(current + (isCorrect ? 1 : -1), 1, 3);

// Smart revision scheduler (Leitner boxes)
const nextBox = (box, isCorrect) => (isCorrect ? Math.min(box + 1, 5) : 1);
const intervalDays = (box) => REVISION_INTERVALS[clamp(box, 1, 5) - 1];

// Confidence-based assessment
function classifyConfidence(confidence, isCorrect) {
  if (confidence === "sure" && !isCorrect) return "overconfident"; // believes a wrong idea
  if (confidence === "guess" && isCorrect) return "lucky"; // right, but not really known
  return "calibrated";
}

// Live battle: 100 points for a correct answer + up to 50 speed bonus
function battlePoints(isCorrect, secondsLeft, secondsPerQuestion) {
  if (!isCorrect) return 0;
  const ratio = clamp(secondsLeft / secondsPerQuestion, 0, 1);
  return 100 + Math.round(50 * ratio);
}

// Dates are handled in Indian Standard Time (UTC+5:30) because the students are in India.
const IST_OFFSET_MS = 330 * 60 * 1000;
function addDaysIST(days = 0) {
  return new Date(Date.now() + IST_OFFSET_MS + days * 86400000).toISOString().slice(0, 10);
}
const todayIST = () => addDaysIST(0);

const isValidEmail = (e) => typeof e === "string" && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isValidPassword = (p) =>
  typeof p === "string" && p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);

module.exports = {
  clamp, calcMarks, percentOf, starsFor, levelFromXp, nextDifficulty, nextBox, intervalDays,
  classifyConfidence, battlePoints, addDaysIST, todayIST, isValidEmail, isValidPassword,
};
