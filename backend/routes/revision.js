// Smart Revision Scheduler (Leitner boxes: 1, 3, 7, 14, 30 days)
const express = require("express");
const supabase = require("../supabase");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { db, parseId } = require("../utils/engine");
const { nextBox, intervalDays, addDaysIST, todayIST } = require("../utils/scoring");

const router = express.Router();

// GET /api/revision/due -> up to 10 cards due today (or earlier), without answers
router.get("/due", requireAuth, asyncHandler(async (req, res) => {
  const items = db(await supabase.from("revision_items")
    .select("id,box,questions(id,question_text,option_a,option_b,option_c,option_d,difficulty)")
    .eq("user_id", req.user.id).lte("due_date", todayIST()).order("due_date").limit(10));
  res.json({
    cards: items.map((i) => ({
      id: i.id, box: i.box,
      question: { id: i.questions.id, text: i.questions.question_text, difficulty: i.questions.difficulty, options: { A: i.questions.option_a, B: i.questions.option_b, C: i.questions.option_c, D: i.questions.option_d } },
    })),
  });
}));

// POST /api/revision/:id/answer  body: { selected_option }
router.post("/:id/answer", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const selected = String(req.body.selected_option || "").toUpperCase();
  if (!id || !["A", "B", "C", "D"].includes(selected)) return res.status(400).json({ error: "Invalid request." });

  const item = db(await supabase.from("revision_items").select("id,box,due_date,times_reviewed,questions(correct_option,explanation)")
    .eq("id", id).eq("user_id", req.user.id).maybeSingle());
  if (!item) return res.status(404).json({ error: "Revision card not found." });
  if (item.due_date > todayIST()) return res.status(400).json({ error: "This card is not due yet." });

  const isCorrect = selected === item.questions.correct_option;
  const box = nextBox(item.box, isCorrect);
  const dueDate = addDaysIST(isCorrect ? intervalDays(box) : 1);
  db(await supabase.from("revision_items").update({ box, due_date: dueDate, times_reviewed: item.times_reviewed + 1 }).eq("id", id));
  if (isCorrect) db(await supabase.rpc("touch_activity", { p_user_id: req.user.id, p_xp: 5 }));

  res.json({ is_correct: isCorrect, correct_option: item.questions.correct_option, explanation: item.questions.explanation, box, next_due: dueDate });
}));

module.exports = router;
