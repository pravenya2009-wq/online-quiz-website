// Live Quiz Battle. No WebSockets (keeps it beginner friendly): the browser polls the server
// every ~1.5 seconds and the SERVER decides which question is "live" from the start time.
const express = require("express");
const crypto = require("crypto");
const supabase = require("../supabase");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { db, parseId, publicQuestion } = require("../utils/engine");
const { battlePoints } = require("../utils/scoring");

const router = express.Router();
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 30;

const newCode = () => Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

async function loadBattle(code) {
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;
  return db(await supabase.from("battles").select("*").eq("code", code).maybeSingle());
}
const loadQuestions = async (battle) =>
  db(await supabase.from("questions").select("*").eq("quiz_id", battle.quiz_id).order("id").limit(10));

// Which question is live right now?
function clock(battle, total) {
  const spq = battle.seconds_per_question;
  const elapsed = (Date.now() - new Date(battle.started_at).getTime()) / 1000;
  const index = Math.floor(elapsed / spq);
  const left = spq - (elapsed - index * spq);
  return { index, left, over: index >= total };
}

// POST /api/battles  body: { quiz_id, seconds_per_question? }
router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const quizId = parseId(req.body.quiz_id);
  const spq = Number(req.body.seconds_per_question || 20);
  if (!quizId) return res.status(400).json({ error: "quiz_id is required." });
  if (!Number.isInteger(spq) || spq < 10 || spq > 60) return res.status(400).json({ error: "Seconds per question must be 10 to 60." });

  const quiz = db(await supabase.from("quizzes").select("id,is_published").eq("id", quizId).maybeSingle());
  if (!quiz || !quiz.is_published) return res.status(404).json({ error: "Quiz not found." });

  for (let tries = 0; tries < 5; tries++) {
    const ins = await supabase.from("battles").insert({ code: newCode(), host_id: req.user.id, quiz_id: quizId, seconds_per_question: spq }).select("id,code").single();
    if (ins.error && ins.error.code === "23505") continue; // code clash, try another
    if (ins.error) throw ins.error;
    db(await supabase.from("battle_players").insert({ battle_id: ins.data.id, user_id: req.user.id }));
    return res.status(201).json({ code: ins.data.code });
  }
  res.status(500).json({ error: "Could not create a room. Try again." });
}));

// POST /api/battles/join  body: { code }
router.post("/join", requireAuth, asyncHandler(async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const battle = await loadBattle(code);
  if (!battle) return res.status(404).json({ error: "Room not found. Check the code." });

  const mine = db(await supabase.from("battle_players").select("user_id").eq("battle_id", battle.id).eq("user_id", req.user.id));
  if (!mine.length) {
    if (battle.status !== "waiting") return res.status(409).json({ error: "This battle has already started." });
    const players = db(await supabase.from("battle_players").select("user_id").eq("battle_id", battle.id));
    if (players.length >= MAX_PLAYERS) return res.status(409).json({ error: "This room is full." });
    db(await supabase.from("battle_players").upsert({ battle_id: battle.id, user_id: req.user.id }, { onConflict: "battle_id,user_id", ignoreDuplicates: true }));
  }
  res.json({ code: battle.code });
}));

// POST /api/battles/:code/start  (host only)
router.post("/:code/start", requireAuth, asyncHandler(async (req, res) => {
  const battle = await loadBattle(req.params.code.toUpperCase());
  if (!battle) return res.status(404).json({ error: "Room not found." });
  if (battle.host_id !== req.user.id) return res.status(403).json({ error: "Only the host can start the battle." });
  const started = db(await supabase.from("battles").update({ status: "live", started_at: new Date().toISOString() }).eq("id", battle.id).eq("status", "waiting").select("id"));
  if (!started.length) return res.status(409).json({ error: "The battle already started." });
  res.json({ ok: true });
}));

// GET /api/battles/:code  -> full state for the polling browser
router.get("/:code", requireAuth, asyncHandler(async (req, res) => {
  const battle = await loadBattle(req.params.code.toUpperCase());
  if (!battle) return res.status(404).json({ error: "Room not found." });
  const member = db(await supabase.from("battle_players").select("user_id").eq("battle_id", battle.id).eq("user_id", req.user.id));
  if (!member.length) return res.status(403).json({ error: "You are not in this room." });

  const questions = await loadQuestions(battle);
  let state = null;
  if (battle.status === "live") {
    state = clock(battle, questions.length);
    if (state.over) {
      await supabase.from("battles").update({ status: "finished" }).eq("id", battle.id).eq("status", "live");
      battle.status = "finished";
    }
  }

  const board = db(await supabase.from("battle_players").select("score,users(name)").eq("battle_id", battle.id).order("score", { ascending: false }));
  const out = {
    code: battle.code, status: battle.status, is_host: battle.host_id === req.user.id, total: questions.length,
    players: board.map((p) => ({ name: p.users.name, score: p.score })), answered: false, question: null,
  };

  if (battle.status === "live") {
    const q = questions[state.index];
    const mine = db(await supabase.from("battle_answers").select("question_id").eq("battle_id", battle.id).eq("user_id", req.user.id).eq("question_id", q.id));
    out.answered = mine.length > 0;
    out.question = { ...publicQuestion(q), index: state.index, seconds_left: Math.max(0, Math.ceil(state.left)) };
  }
  res.json(out);
}));

// POST /api/battles/:code/answer  body: { selected_option }
router.post("/:code/answer", requireAuth, asyncHandler(async (req, res) => {
  const selected = String(req.body.selected_option || "").toUpperCase();
  if (!["A", "B", "C", "D"].includes(selected)) return res.status(400).json({ error: "Invalid option." });

  const battle = await loadBattle(req.params.code.toUpperCase());
  if (!battle) return res.status(404).json({ error: "Room not found." });
  if (battle.status !== "live") return res.status(400).json({ error: "The battle is not live." });
  const member = db(await supabase.from("battle_players").select("user_id").eq("battle_id", battle.id).eq("user_id", req.user.id));
  if (!member.length) return res.status(403).json({ error: "You are not in this room." });

  const questions = await loadQuestions(battle);
  const state = clock(battle, questions.length);
  if (state.over) return res.status(400).json({ error: "The battle is over." });

  const q = questions[state.index];
  const isCorrect = selected === q.correct_option;
  const points = battlePoints(isCorrect, state.left, battle.seconds_per_question);

  const ins = await supabase.from("battle_answers").insert({ battle_id: battle.id, user_id: req.user.id, question_id: q.id, selected_option: selected, is_correct: isCorrect, points });
  if (ins.error) {
    if (ins.error.code === "23505") return res.status(409).json({ error: "You already answered this question." });
    throw ins.error;
  }
  if (points) db(await supabase.rpc("battle_add_score", { p_battle_id: battle.id, p_user_id: req.user.id, p_points: points }));
  res.json({ is_correct: isCorrect, correct_option: q.correct_option, explanation: q.explanation, points });
}));

module.exports = router;
