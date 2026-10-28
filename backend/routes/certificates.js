const express = require("express");
const supabase = require("../supabase");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { db } = require("../utils/engine");

const router = express.Router();

// GET /api/certificates  -> my certificates
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const rows = db(await supabase.from("certificates").select("code,percent,issued_at,quizzes(title,topics(name))").eq("user_id", req.user.id).order("issued_at", { ascending: false }));
  res.json({ certificates: rows.map((c) => ({ code: c.code, percent: c.percent, issued_at: c.issued_at, quiz: c.quizzes.title, topic: c.quizzes.topics.name })) });
}));

// GET /api/certificates/:code  -> PUBLIC verification (shows only name, quiz, score, date)
router.get("/:code", asyncHandler(async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!/^NQ-[A-F0-9]{10}$/.test(code)) return res.status(404).json({ error: "Certificate not found." });
  const c = db(await supabase.from("certificates").select("code,percent,issued_at,users(name),quizzes(title,topics(name))").eq("code", code).maybeSingle());
  if (!c) return res.status(404).json({ error: "Certificate not found." });
  res.json({ code: c.code, percent: c.percent, issued_at: c.issued_at, student: c.users.name, quiz: c.quizzes.title, topic: c.quizzes.topics.name });
}));

module.exports = router;
