// Shared game logic used by several routes: grading, revision cards, elements, XP and badges.
const crypto = require("crypto");
const supabase = require("../supabase");
const { calcMarks, classifyConfidence, addDaysIST } = require("./scoring");

const ADAPTIVE_LENGTH = 10;

// Throw if Supabase returned an error, otherwise return the data.
const db = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

const parseId = (v) => (/^\d+$/.test(String(v)) && Number(v) > 0 ? Number(v) : null);

// Question without the answer (safe to send to the browser)
const publicQuestion = (q) => ({
  id: q.id,
  text: q.question_text,
  difficulty: q.difficulty,
  options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
});

async function collectElements(userId, numbers) {
  if (!numbers.length) return [];
  const have = db(await supabase.from("user_elements").select("element_number").eq("user_id", userId).in("element_number", numbers));
  const owned = new Set(have.map((r) => r.element_number));
  const fresh = numbers.filter((n) => !owned.has(n));
  if (!fresh.length) return [];
  db(await supabase.from("user_elements").upsert(fresh.map((n) => ({ user_id: userId, element_number: n })), { onConflict: "user_id,element_number", ignoreDuplicates: true }));
  return db(await supabase.from("elements").select("atomic_number,symbol,name").in("atomic_number", fresh));
}

// items: [{ question, selected ("A".."D" or null), confidence }]
async function recordAnswers(userId, attemptId, items) {
  const rows = [];
  const revisionIds = [];
  const elementNumbers = new Set();
  let score = 0, correct = 0, wrong = 0, maxScore = 0;

  for (const { question: q, selected, confidence } of items) {
    const isCorrect = selected === q.correct_option;
    const marks = calcMarks(selected, q.correct_option, q.marks, q.negative_marks);
    score += marks;
    maxScore += q.marks;
    if (isCorrect) correct++;
    else if (selected) wrong++;

    rows.push({
      attempt_id: attemptId, user_id: userId, question_id: q.id,
      selected_option: selected || null, confidence, is_correct: isCorrect, marks_awarded: marks,
    });

    // Wrong answers and lucky guesses go to the revision scheduler
    if (selected && (!isCorrect || classifyConfidence(confidence, isCorrect) === "lucky")) revisionIds.push(q.id);
    if (isCorrect && q.element_number) elementNumbers.add(q.element_number);
  }

  db(await supabase.from("attempt_answers").insert(rows));

  if (revisionIds.length) {
    db(await supabase.from("revision_items").upsert(
      revisionIds.map((id) => ({ user_id: userId, question_id: id, box: 1, due_date: addDaysIST(1) })),
      { onConflict: "user_id,question_id" }
    ));
  }
  const newElements = await collectElements(userId, [...elementNumbers]);
  return { score, correct, wrong, maxScore, newElements, revisionAdded: revisionIds.length };
}

async function checkBadges(userId, { percent, mode, streak }) {
  const count = async (table, extra = (q) => q) => {
    const r = await extra(supabase.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId));
    if (r.error) throw r.error;
    return r.count || 0;
  };
  const [attempts, elements, certs] = await Promise.all([
    count("attempts", (q) => q.eq("status", "submitted")),
    count("user_elements"),
    count("certificates"),
  ]);

  const earned = new Set();
  if (attempts >= 1) earned.add("first_quest");
  if (percent === 100) earned.add("perfect_score");
  if (streak >= 3) earned.add("streak_3");
  if (elements >= 5) earned.add("collector_5");
  if (mode === "adaptive" && percent >= 80) earned.add("adaptive_ace");
  if (certs >= 1) earned.add("scholar");

  const have = db(await supabase.from("user_badges").select("badge_code").eq("user_id", userId));
  const owned = new Set(have.map((b) => b.badge_code));
  const fresh = [...earned].filter((c) => !owned.has(c));
  if (!fresh.length) return [];
  db(await supabase.from("user_badges").upsert(fresh.map((c) => ({ user_id: userId, badge_code: c })), { onConflict: "user_id,badge_code", ignoreDuplicates: true }));
  return db(await supabase.from("badges").select("code,title,emoji,description").in("code", fresh));
}

// Adds XP + updates streak in ONE database function, then checks for new badges.
async function giveRewards(userId, { xp, percent, mode }) {
  const data = db(await supabase.rpc("touch_activity", { p_user_id: userId, p_xp: xp }));
  const row = Array.isArray(data) ? data[0] : data;
  const newBadges = await checkBadges(userId, { percent, mode, streak: row.out_streak });
  return { xpTotal: row.out_xp, streak: row.out_streak, newBadges };
}

async function pickAdaptiveQuestion(attempt) {
  const answered = db(await supabase.from("attempt_answers").select("question_id").eq("attempt_id", attempt.id));
  if (answered.length >= ADAPTIVE_LENGTH) return null;

  const pool = db(await supabase.from("questions").select("*, quizzes!inner(topic_id,is_published)")
    .eq("quizzes.topic_id", attempt.topic_id).eq("quizzes.is_published", true));
  const seen = new Set(answered.map((a) => a.question_id));
  const left = pool.filter((q) => !seen.has(q.id));
  if (!left.length) return null;

  // choose the question closest to the student's current level
  const gap = (q) => Math.abs(q.difficulty - attempt.current_difficulty);
  const best = Math.min(...left.map(gap));
  const candidates = left.filter((q) => gap(q) === best);
  return candidates[crypto.randomInt(candidates.length)];
}

const insightFor = (confidence, isCorrect) => {
  const kind = classifyConfidence(confidence, isCorrect);
  if (kind === "overconfident") return "You were sure, but this was wrong - a misconception worth fixing. Added to revision.";
  if (kind === "lucky") return "Correct, but you guessed. Added to revision so it sticks.";
  return null;
};

module.exports = { ADAPTIVE_LENGTH, db, parseId, publicQuestion, recordAnswers, giveRewards, pickAdaptiveQuestion, insightFor };
