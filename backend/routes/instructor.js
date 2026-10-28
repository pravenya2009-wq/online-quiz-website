// Instructor tools: create quizzes (levels) and add/delete questions.
const express = require("express");
const supabase = require("../supabase");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { db, parseId } = require("../utils/engine");

const router = express.Router();
router.use(requireAuth, requireRole("instructor"));

const intIn = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;

// GET /api/instructor/topics -> subjects with their topics (for the form dropdown)
router.get("/topics", asyncHandler(async (req, res) => {
  res.json({ subjects: db(await supabase.from("subjects").select("id,name,emoji,topics(id,name)").order("id")) });
}));

// GET /api/instructor/quizzes
router.get("/quizzes", asyncHandler(async (req, res) => {
  const quizzes = db(await supabase.from("quizzes").select("id,title,level_no,is_published,created_by,topics(name),questions(count)").order("topic_id").order("level_no"));
  res.json({
    me: req.user.id,
    quizzes: quizzes.map((q) => ({ id: q.id, title: q.title, level_no: q.level_no, topic: q.topics.name, questions: q.questions[0]?.count || 0, mine: q.created_by === req.user.id })),
  });
}));

// POST /api/instructor/quizzes
router.post("/quizzes", asyncHandler(async (req, res) => {
  const { topic_id, title, level_no, time_limit_minutes = 10, pass_percent = 60 } = req.body;
  const cleanTitle = String(title || "").trim();
  if (!parseId(topic_id)) return res.status(400).json({ error: "Choose a topic." });
  if (cleanTitle.length < 3 || cleanTitle.length > 80) return res.status(400).json({ error: "Title must be 3 to 80 characters." });
  if (!intIn(level_no, 1, 50)) return res.status(400).json({ error: "Level number must be 1 to 50." });
  if (!intIn(time_limit_minutes, 1, 120)) return res.status(400).json({ error: "Time limit must be 1 to 120 minutes." });
  if (!intIn(pass_percent, 1, 100)) return res.status(400).json({ error: "Pass percent must be 1 to 100." });

  const ins = await supabase.from("quizzes").insert({
    topic_id: Number(topic_id), title: cleanTitle, level_no: Number(level_no),
    time_limit_minutes: Number(time_limit_minutes), pass_percent: Number(pass_percent), created_by: req.user.id,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return res.status(409).json({ error: "That topic already has a quiz with this level number." });
    if (ins.error.code === "23503") return res.status(400).json({ error: "Topic not found." });
    throw ins.error;
  }
  res.status(201).json({ id: ins.data.id });
}));

// GET /api/instructor/quizzes/:id  -> quiz + all questions WITH answers + simple stats
router.get("/quizzes/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });
  const quiz = db(await supabase.from("quizzes").select("id,title,level_no,time_limit_minutes,pass_percent,created_by,topics(name)").eq("id", id).maybeSingle());
  if (!quiz) return res.status(404).json({ error: "Quiz not found." });
  const questions = db(await supabase.from("questions").select("*").eq("quiz_id", id).order("id"));
  const attempts = db(await supabase.from("attempts").select("percent").eq("quiz_id", id).eq("mode", "level").eq("status", "submitted"));
  const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.percent, 0) / attempts.length) : null;
  res.json({
    quiz: { id: quiz.id, title: quiz.title, level_no: quiz.level_no, topic: quiz.topics.name, time_limit_minutes: quiz.time_limit_minutes, pass_percent: quiz.pass_percent, mine: quiz.created_by === req.user.id },
    questions, stats: { attempts: attempts.length, average_percent: avg },
  });
}));

// POST /api/instructor/quizzes/:id/questions
router.post("/quizzes/:id/questions", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const b = req.body;
  const text = String(b.question_text || "").trim();
  const opts = ["option_a", "option_b", "option_c", "option_d"].map((k) => String(b[k] || "").trim());
  if (!id) return res.status(400).json({ error: "Invalid quiz id." });
  if (text.length < 5 || text.length > 500) return res.status(400).json({ error: "Question must be 5 to 500 characters." });
  if (opts.some((o) => !o || o.length > 200)) return res.status(400).json({ error: "All four options are required (max 200 characters)." });
  if (!["A", "B", "C", "D"].includes(b.correct_option)) return res.status(400).json({ error: "Choose the correct option." });
  if (!intIn(b.difficulty || 2, 1, 3)) return res.status(400).json({ error: "Difficulty must be 1, 2 or 3." });
  const element = b.element_number ? Number(b.element_number) : null;
  if (element !== null && !intIn(element, 1, 118)) return res.status(400).json({ error: "Element number must be 1 to 118." });

  const quiz = db(await supabase.from("quizzes").select("id,created_by").eq("id", id).maybeSingle());
  if (!quiz) return res.status(404).json({ error: "Quiz not found." });
  if (quiz.created_by !== req.user.id) return res.status(403).json({ error: "You can only edit quizzes you created." });

  const ins = await supabase.from("questions").insert({
    quiz_id: id, question_text: text, option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: opts[3],
    correct_option: b.correct_option, explanation: String(b.explanation || "").trim().slice(0, 500),
    difficulty: Number(b.difficulty || 2), element_number: element,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23503") return res.status(400).json({ error: "That element is not in the elements table." });
    throw ins.error;
  }
  res.status(201).json({ id: ins.data.id });
}));

// DELETE /api/instructor/questions/:id
router.delete("/questions/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });
  const q = db(await supabase.from("questions").select("id,quizzes(created_by)").eq("id", id).maybeSingle());
  if (!q) return res.status(404).json({ error: "Question not found." });
  if (q.quizzes.created_by !== req.user.id) return res.status(403).json({ error: "You can only edit quizzes you created." });
  db(await supabase.from("questions").delete().eq("id", id));
  res.json({ ok: true });
}));

// DELETE /api/instructor/quizzes/:id
router.delete("/quizzes/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });
  const quiz = db(await supabase.from("quizzes").select("id,created_by").eq("id", id).maybeSingle());
  if (!quiz) return res.status(404).json({ error: "Quiz not found." });
  if (quiz.created_by !== req.user.id) return res.status(403).json({ error: "You can only delete quizzes you created." });
  db(await supabase.from("quizzes").delete().eq("id", id));
  res.json({ ok: true });
}));

module.exports = router;
