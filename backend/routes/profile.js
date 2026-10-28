// Dashboard, Adventure Map, Quiz Mentor and Collection (elements + badges)
const express = require("express");
const supabase = require("../supabase");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { db } = require("../utils/engine");
const { levelFromXp, todayIST, addDaysIST } = require("../utils/scoring");
const { buildMentorAdvice } = require("../utils/mentor");

const router = express.Router();
router.use(requireAuth);

async function countDue(userId) {
  const r = await supabase.from("revision_items").select("*", { count: "exact", head: true }).eq("user_id", userId).lte("due_date", todayIST());
  if (r.error) throw r.error;
  return r.count || 0;
}

// GET /api/profile/dashboard
router.get("/dashboard", asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const [user, dueCount, recent, badges, owned, totalEl] = await Promise.all([
    supabase.from("users").select("name,role,xp,streak,last_active").eq("id", uid).single().then(db),
    countDue(uid),
    supabase.from("attempts").select("id,mode,percent,stars,score,max_score,finished_at,quizzes(title),topics(name)").eq("user_id", uid).eq("status", "submitted").order("finished_at", { ascending: false }).limit(5).then(db),
    supabase.from("user_badges").select("earned_at,badges(code,title,emoji,description)").eq("user_id", uid).order("earned_at", { ascending: false }).then(db),
    supabase.from("user_elements").select("*", { count: "exact", head: true }).eq("user_id", uid),
    supabase.from("elements").select("*", { count: "exact", head: true }),
  ]);
  // a streak is only alive if the student was active today or yesterday
  const alive = user.last_active && user.last_active >= addDaysIST(-1);
  res.json({
    user: { name: user.name, role: user.role, xp: user.xp, level: levelFromXp(user.xp), xp_into_level: user.xp % 100, streak: alive ? user.streak : 0 },
    due_count: dueCount,
    recent: recent.map((a) => ({ id: a.id, mode: a.mode, title: a.mode === "level" ? a.quizzes?.title : `Adaptive: ${a.topics?.name}`, percent: a.percent, stars: a.stars, finished_at: a.finished_at })),
    badges: badges.map((b) => b.badges),
    elements_collected: owned.count || 0,
    elements_total: totalEl.count || 0,
  });
}));

// GET /api/profile/adventure -> worlds (subjects) > topics > levels (quizzes) with stars and locks
router.get("/adventure", asyncHandler(async (req, res) => {
  const [subjects, quizzes, attempts] = await Promise.all([
    supabase.from("subjects").select("id,name,emoji,color,description,topics(id,name)").order("id").then(db),
    supabase.from("quizzes").select("id,topic_id,title,level_no,time_limit_minutes,pass_percent,questions(count)").eq("is_published", true).order("level_no").then(db),
    supabase.from("attempts").select("quiz_id,percent,stars").eq("user_id", req.user.id).eq("mode", "level").eq("status", "submitted").then(db),
  ]);
  const best = new Map();
  for (const a of attempts) {
    const b = best.get(a.quiz_id) || { percent: 0, stars: 0 };
    best.set(a.quiz_id, { percent: Math.max(b.percent, a.percent), stars: Math.max(b.stars, a.stars) });
  }
  const isInstructor = req.user.role === "instructor";

  const worlds = subjects.map((s) => ({
    id: s.id, name: s.name, emoji: s.emoji, color: s.color, description: s.description,
    topics: s.topics.sort((a, b) => a.id - b.id).map((t) => {
      let previousPassed = true;
      const levels = quizzes.filter((q) => q.topic_id === t.id).map((q) => {
        const b = best.get(q.id) || { percent: 0, stars: 0 };
        const level = {
          id: q.id, title: q.title, level_no: q.level_no, questions: q.questions[0]?.count || 0,
          time_limit_minutes: q.time_limit_minutes, pass_percent: q.pass_percent,
          best_percent: b.percent, stars: b.stars, locked: !(previousPassed || isInstructor),
        };
        previousPassed = b.percent >= q.pass_percent && b.stars > 0;
        return level;
      });
      return { id: t.id, name: t.name, levels };
    }),
  }));
  res.json({ worlds });
}));

// GET /api/profile/mentor
router.get("/mentor", asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const rows = db(await supabase.from("attempt_answers").select("is_correct,confidence,selected_option,questions(quizzes(topic_id,topics(name)))").eq("user_id", uid).limit(2000));
  const topics = new Map();
  let overconfident = 0, lucky = 0, totalAnswered = 0;
  for (const r of rows) {
    if (!r.selected_option) continue;
    totalAnswered++;
    if (r.confidence === "sure" && !r.is_correct) overconfident++;
    if (r.confidence === "guess" && r.is_correct) lucky++;
    const topic = r.questions?.quizzes?.topics;
    const topicId = r.questions?.quizzes?.topic_id;
    if (!topic) continue;
    const t = topics.get(topicId) || { topicId, name: topic.name, answered: 0, correct: 0 };
    t.answered++;
    if (r.is_correct) t.correct++;
    topics.set(topicId, t);
  }
  const user = db(await supabase.from("users").select("streak,last_active").eq("id", uid).single());
  const streak = user.last_active && user.last_active >= addDaysIST(-1) ? user.streak : 0;
  const tips = buildMentorAdvice({ topicStats: [...topics.values()], overconfident, lucky, dueCount: await countDue(uid), totalAnswered, streak });
  res.json({ tips, stats: { total_answered: totalAnswered, overconfident, lucky } });
}));

// GET /api/profile/collection
router.get("/collection", asyncHandler(async (req, res) => {
  const [elements, owned, badges, earned] = await Promise.all([
    supabase.from("elements").select("atomic_number,symbol,name,category").order("atomic_number").then(db),
    supabase.from("user_elements").select("element_number").eq("user_id", req.user.id).then(db),
    supabase.from("badges").select("code,title,emoji,description").then(db),
    supabase.from("user_badges").select("badge_code").eq("user_id", req.user.id).then(db),
  ]);
  const have = new Set(owned.map((o) => o.element_number));
  const got = new Set(earned.map((e) => e.badge_code));
  res.json({
    elements: elements.map((e) => ({ ...e, collected: have.has(e.atomic_number) })),
    badges: badges.map((b) => ({ ...b, earned: got.has(b.code) })),
  });
}));

module.exports = router;
