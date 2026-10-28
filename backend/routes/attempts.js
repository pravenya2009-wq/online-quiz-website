// Quiz Adventure Mode (levels) + Adaptive Quiz Engine + Confidence-Based Assessment
const express = require("express");
const crypto = require("crypto");
const supabase = require("../supabase");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { db, parseId, publicQuestion, recordAnswers, giveRewards, pickAdaptiveQuestion, insightFor, ADAPTIVE_LENGTH } = require("../utils/engine");
const { percentOf, starsFor, nextDifficulty } = require("../utils/scoring");

const router = express.Router();
const OPTIONS = ["A", "B", "C", "D"];
const CONFIDENCE = ["sure", "unsure", "guess"];

// A level is unlocked when the previous level of the same topic was passed.
async function isUnlocked(userId, quiz) {
  const prev = db(await supabase.from("quizzes").select("id,pass_percent").eq("topic_id", quiz.topic_id)
    .eq("is_published", true).lt("level_no", quiz.level_no).order("level_no", { ascending: false }).limit(1));
  if (!prev.length) return true;
  const passed = db(await supabase.from("attempts").select("id").eq("user_id", userId).eq("quiz_id", prev[0].id)
    .eq("mode", "level").eq("status", "submitted").gte("percent", prev[0].pass_percent).limit(1));
  return passed.length > 0;
}

// POST /api/quizzes/:id/start  -> creates an attempt and returns questions WITHOUT answers
router.post("/quizzes/:id/start", requireAuth, asyncHandler(async (req, res) => {
  const quizId = parseId(req.params.id);
  if (!quizId) return res.status(400).json({ error: "Invalid quiz id." });

  const quiz = db(await supabase.from("quizzes").select("id,topic_id,title,level_no,time_limit_minutes,pass_percent,is_published").eq("id", quizId).maybeSingle());
  if (!quiz || !quiz.is_published) return res.status(404).json({ error: "Quiz not found." });
  if (req.user.role !== "instructor" && !(await isUnlocked(req.user.id, quiz))) {
    return res.status(403).json({ error: "This level is locked. Pass the previous level first." });
  }

  const questions = db(await supabase.from("questions").select("*").eq("quiz_id", quizId).order("id"));
  if (!questions.length) return res.status(400).json({ error: "This quiz has no questions yet." });

  const attempt = db(await supabase.from("attempts").insert({
    user_id: req.user.id, quiz_id: quizId, mode: "level",
    total: questions.length, max_score: questions.reduce((s, q) => s + q.marks, 0),
  }).select("id").single());

  res.status(201).json({
    attempt_id: attempt.id,
    quiz: { title: quiz.title, time_limit_minutes: quiz.time_limit_minutes, pass_percent: quiz.pass_percent },
    questions: questions.map(publicQuestion),
  });
}));

// POST /api/attempts/:id/submit  body: { answers: [{question_id, selected_option, confidence}] }
router.post("/attempts/:id/submit", requireAuth, asyncHandler(async (req, res) => {
  const attemptId = parseId(req.params.id);
  if (!attemptId) return res.status(400).json({ error: "Invalid attempt id." });
  const submitted = req.body.answers;
  if (!Array.isArray(submitted) || submitted.length > 200) return res.status(400).json({ error: "answers must be an array." });

  const attempt = db(await supabase.from("attempts").select("*").eq("id", attemptId).eq("user_id", req.user.id).eq("mode", "level").maybeSingle());
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  if (attempt.status !== "in_progress") return res.status(409).json({ error: "This attempt was already submitted." });

  const quiz = db(await supabase.from("quizzes").select("id,title,time_limit_minutes,pass_percent").eq("id", attempt.quiz_id).single());

  // Time limit is enforced by the SERVER (60 seconds grace for slow networks)
  const elapsed = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
  if (elapsed > quiz.time_limit_minutes * 60 + 60) {
    await supabase.from("attempts").update({ status: "expired", finished_at: new Date().toISOString() }).eq("id", attemptId).eq("status", "in_progress");
    return res.status(400).json({ error: "Time is over for this attempt. Start the level again." });
  }

  const questions = db(await supabase.from("questions").select("*").eq("quiz_id", attempt.quiz_id).order("id"));
  const byId = new Map();
  for (const a of submitted) {
    const qid = Number(a && a.question_id);
    if (!questions.some((q) => q.id === qid)) return res.status(400).json({ error: "An answer refers to a question outside this quiz." });
    const selected = a.selected_option == null ? null : String(a.selected_option).toUpperCase();
    if (selected !== null && !OPTIONS.includes(selected)) return res.status(400).json({ error: "Invalid option." });
    const confidence = CONFIDENCE.includes(a.confidence) ? a.confidence : "unsure";
    byId.set(qid, { selected, confidence });
  }

  // Claim the attempt first: a second click / double request fails here (prevents double rewards)
  const claimed = db(await supabase.from("attempts").update({ status: "submitted", finished_at: new Date().toISOString() })
    .eq("id", attemptId).eq("status", "in_progress").select("id"));
  if (!claimed.length) return res.status(409).json({ error: "This attempt was already submitted." });

  const items = questions.map((q) => ({ question: q, selected: byId.get(q.id)?.selected || null, confidence: byId.get(q.id)?.confidence || "unsure" }));
  let rec;
  try {
    rec = await recordAnswers(req.user.id, attemptId, items);
  } catch (err) {
    await supabase.from("attempts").update({ status: "in_progress", finished_at: null }).eq("id", attemptId);
    throw err;
  }

  const percent = percentOf(rec.score, rec.maxScore);
  const stars = starsFor(percent, quiz.pass_percent);
  const passed = percent >= quiz.pass_percent;
  db(await supabase.from("attempts").update({ score: rec.score, max_score: rec.maxScore, correct_count: rec.correct, wrong_count: rec.wrong, percent, stars }).eq("id", attemptId));

  // Instant certificate (first time the level is passed)
  let certificate = null;
  if (passed) {
    const existing = db(await supabase.from("certificates").select("code,percent").eq("user_id", req.user.id).eq("quiz_id", quiz.id).limit(1));
    if (existing.length) certificate = { ...existing[0], is_new: false };
    else {
      const code = "NQ-" + crypto.randomBytes(5).toString("hex").toUpperCase();
      const ins = await supabase.from("certificates").insert({ code, user_id: req.user.id, quiz_id: quiz.id, percent }).select("code,percent").single();
      if (!ins.error) certificate = { ...ins.data, is_new: true };
    }
  }

  const xpEarned = rec.correct * 10 + 20;
  const rewards = await giveRewards(req.user.id, { xp: xpEarned, percent, mode: "level" });

  const review = items.map(({ question: q, selected, confidence }) => ({
    question_id: q.id, text: q.question_text, options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
    selected, correct_option: q.correct_option, explanation: q.explanation, confidence,
    is_correct: selected === q.correct_option, insight: selected ? insightFor(confidence, selected === q.correct_option) : null,
  }));

  res.json({
    title: quiz.title, score: rec.score, max_score: rec.maxScore, percent, stars, passed, pass_percent: quiz.pass_percent,
    correct: rec.correct, wrong: rec.wrong, unanswered: items.length - rec.correct - rec.wrong,
    xp_earned: xpEarned, new_elements: rec.newElements, new_badges: rewards.newBadges, certificate, review,
  });
}));

// ---------- Adaptive Quiz Engine ----------

// POST /api/adaptive/start  body: { topic_id }
router.post("/adaptive/start", requireAuth, asyncHandler(async (req, res) => {
  const topicId = parseId(req.body.topic_id);
  if (!topicId) return res.status(400).json({ error: "topic_id is required." });
  const topic = db(await supabase.from("topics").select("id,name").eq("id", topicId).maybeSingle());
  if (!topic) return res.status(404).json({ error: "Topic not found." });

  const attempt = db(await supabase.from("attempts").insert({ user_id: req.user.id, topic_id: topicId, mode: "adaptive", current_difficulty: 2 }).select("*").single());
  const first = await pickAdaptiveQuestion(attempt);
  if (!first) return res.status(400).json({ error: "This topic has no questions yet." });
  res.status(201).json({ attempt_id: attempt.id, topic: topic.name, question: publicQuestion(first), answered: 0, difficulty: 2, length: ADAPTIVE_LENGTH });
}));

// POST /api/adaptive/:id/answer  body: { question_id, selected_option, confidence }
router.post("/adaptive/:id/answer", requireAuth, asyncHandler(async (req, res) => {
  const attemptId = parseId(req.params.id);
  const questionId = parseId(req.body.question_id);
  const selected = String(req.body.selected_option || "").toUpperCase();
  const confidence = CONFIDENCE.includes(req.body.confidence) ? req.body.confidence : "unsure";
  if (!attemptId || !questionId || !OPTIONS.includes(selected)) return res.status(400).json({ error: "Invalid request." });

  const attempt = db(await supabase.from("attempts").select("*").eq("id", attemptId).eq("user_id", req.user.id).eq("mode", "adaptive").maybeSingle());
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  if (attempt.status !== "in_progress") return res.status(409).json({ error: "This practice session is finished." });

  const q = db(await supabase.from("questions").select("*, quizzes!inner(topic_id)").eq("id", questionId).eq("quizzes.topic_id", attempt.topic_id).maybeSingle());
  if (!q) return res.status(400).json({ error: "Question does not belong to this practice session." });

  let rec;
  try {
    rec = await recordAnswers(req.user.id, attemptId, [{ question: q, selected, confidence }]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "You already answered this question." });
    throw err;
  }
  const isCorrect = selected === q.correct_option;
  const updated = {
    ...attempt,
    score: attempt.score + rec.score, max_score: attempt.max_score + q.marks, total: attempt.total + 1,
    correct_count: attempt.correct_count + (isCorrect ? 1 : 0), wrong_count: attempt.wrong_count + (isCorrect ? 0 : 1),
    current_difficulty: nextDifficulty(attempt.current_difficulty, isCorrect),
  };
  db(await supabase.from("attempts").update({
    score: updated.score, max_score: updated.max_score, total: updated.total, correct_count: updated.correct_count,
    wrong_count: updated.wrong_count, current_difficulty: updated.current_difficulty,
  }).eq("id", attemptId));

  const feedback = {
    is_correct: isCorrect, correct_option: q.correct_option, explanation: q.explanation, marks: rec.score,
    new_elements: rec.newElements, insight: insightFor(confidence, isCorrect),
  };

  const next = await pickAdaptiveQuestion(updated);
  if (next) {
    return res.json({ finished: false, feedback, next_question: publicQuestion(next), answered: updated.total, difficulty: updated.current_difficulty });
  }

  // No more questions: finish the session
  const percent = percentOf(updated.score, updated.max_score);
  const claimed = db(await supabase.from("attempts").update({ status: "submitted", finished_at: new Date().toISOString(), percent, stars: starsFor(percent, 60) })
    .eq("id", attemptId).eq("status", "in_progress").select("id"));
  let xpEarned = 0, newBadges = [];
  if (claimed.length) {
    xpEarned = updated.correct_count * 10 + 20;
    newBadges = (await giveRewards(req.user.id, { xp: xpEarned, percent, mode: "adaptive" })).newBadges;
  }
  res.json({
    finished: true, feedback,
    summary: { correct: updated.correct_count, wrong: updated.wrong_count, total: updated.total, score: updated.score, max_score: updated.max_score, percent, xp_earned: xpEarned, new_badges: newBadges },
  });
}));

module.exports = router;
