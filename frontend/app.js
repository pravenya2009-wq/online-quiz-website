"use strict";
/* NEET Quest frontend - plain HTML + CSS + vanilla JavaScript.
   One page, hash-based routing (#/home, #/map, ...). All user-provided text goes through esc() (XSS safe). */

const app = document.getElementById("app");
const navEl = document.getElementById("nav");
let me; // undefined = not checked yet, null = logged out, object = logged in
let timer = null; // one interval per page (countdowns / polling)
const OPT = ["A", "B", "C", "D"];
const CONF = [["sure", "😎 Sure"], ["unsure", "🤔 Not sure"], ["guess", "🎲 Guess"]];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const starsText = (n) => "★".repeat(n) + "☆".repeat(3 - n);

function toast(msg, type = "info") {
  const d = document.createElement("div");
  d.className = "toast " + type;
  d.textContent = msg;
  document.getElementById("toasts").appendChild(d);
  setTimeout(() => d.remove(), 3800);
}

async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "quest-app" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || "Something went wrong. Please try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

// Run an async action; show errors as toasts and re-enable the button
async function guarded(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); }
  catch (err) { if (err.status === 401) { me = null; location.hash = "#/"; } toast(err.message, "error"); }
  finally { if (button && button.isConnected) button.disabled = false; }
}

/* ---------- Shared question widgets ---------- */
const optionButtons = (q, picked, locked) => OPT.map((k) =>
  `<button type="button" class="opt ${picked === k ? "picked" : ""}" data-opt="${k}" ${locked ? "disabled" : ""}><b>${k}</b><span>${esc(q.options[k])}</span></button>`).join("");
const confidenceButtons = (sel) =>
  `<div class="conf" role="group" aria-label="How sure are you?"><span class="muted">How sure are you?</span>${CONF.map(([k, l]) => `<button type="button" class="chip ${sel === k ? "picked" : ""}" data-conf="${k}">${l}</button>`).join("")}</div>`;
function reveal(root, picked, correct) {
  qsa(".opt", root).forEach((b) => {
    b.disabled = true;
    b.classList.remove("picked");
    if (b.dataset.opt === correct) b.classList.add("right");
    else if (b.dataset.opt === picked) b.classList.add("wrong");
  });
}
const elementsHtml = (list) => (list && list.length ? `<p>🎉 New element collected: ${list.map((e) => `<span class="badge-pill"><b>${esc(e.symbol)}</b> ${esc(e.name)}</span>`).join("")}</p>` : "");
const badgesHtml = (list) => (list && list.length ? `<p>🏅 New badge: ${list.map((b) => `<span class="badge-pill">${esc(b.emoji)} ${esc(b.title)}</span>`).join("")}</p>` : "");

/* ---------- Navigation ---------- */
function renderNav() {
  const hash = location.hash || "#/";
  if (!me) { navEl.innerHTML = `<div class="nav-inner"><a class="brand" href="#/">⚡ NEET Quest</a></div>`; return; }
  const links = [["#/home", "🏠 Home"], ["#/map", "🗺️ Map"], ["#/revision", "🔁 Revision"], ["#/battle", "⚔️ Battle"], ["#/collection", "⚗️ Collection"], ["#/certificates", "🎓 Certificates"]];
  if (me.role === "instructor") links.push(["#/instructor", "🧑‍🏫 Instructor"]);
  navEl.innerHTML = `<nav class="nav-inner" aria-label="Main"><a class="brand" href="#/home">⚡ NEET Quest</a>
    ${links.map(([h, l]) => `<a class="link ${hash.startsWith(h) ? "active" : ""}" href="${h}">${l}</a>`).join("")}
    <span class="spacer"></span><button class="btn ghost small" id="logout">Log out</button></nav>`;
  qs("#logout").addEventListener("click", async () => {
    try { await api("/auth/logout", "POST"); } catch { /* ignore */ }
    me = null; location.hash = "#/"; renderNav();
  });
}

/* ---------- Auth page ---------- */
function authPage() {
  if (me) { location.hash = "#/home"; return; }
  let mode = "login";
  let role = "student";
  const draw = () => {
    app.innerHTML = `<section class="card hero split">
      <div><h1>Crack NEET like a game 🎮</h1>
        <p class="muted">Travel through Physics, Chemistry and Biology worlds. Clear levels, collect chemical elements, win battles and earn certificates.</p>
        <p>⚡ Adaptive practice &nbsp; 🗺️ Adventure map &nbsp; ⚔️ Live battles &nbsp; 🔁 Smart revision</p></div>
      <div>
        <div class="tabs"><button class="btn ${mode === "login" ? "" : "ghost"}" id="tab-login" type="button">Log in</button><button class="btn ${mode === "register" ? "" : "ghost"}" id="tab-register" type="button">Sign up</button></div>
        <form id="auth-form" novalidate>
          ${mode === "register" ? `<label>Your name<input name="name" autocomplete="name" required minlength="2" maxlength="60"></label>` : ""}
          <label>Email<input name="email" type="email" autocomplete="email" required></label>
          <label>Password<input name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required minlength="8"></label>
          ${mode === "register" ? `<small class="muted">At least 8 characters, with a letter and a number.</small>
            <label>I am a<select name="role"><option value="student" ${role === "student" ? "selected" : ""}>Student</option><option value="instructor" ${role === "instructor" ? "selected" : ""}>Instructor</option></select></label>
            ${role === "instructor" ? `<label>Instructor invite code<input name="invite_code" type="password" autocomplete="off"></label>` : ""}` : ""}
          <button class="btn gold" type="submit">${mode === "login" ? "Start playing" : "Create my account"}</button>
          <p class="error-text" id="auth-error" style="color:var(--red);margin:0" role="alert"></p>
        </form></div></section>`;
    qs("#tab-login").onclick = () => { mode = "login"; draw(); };
    qs("#tab-register").onclick = () => { mode = "register"; draw(); };
    const roleSel = qs("select[name=role]");
    if (roleSel) roleSel.onchange = () => { role = roleSel.value; draw(); };
    qs("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const btn = qs("button[type=submit]", e.target);
      btn.disabled = true;
      try {
        const data = await api(mode === "login" ? "/auth/login" : "/auth/register", "POST", f);
        me = data.user;
        location.hash = "#/home"; // the hashchange event renders the page
      } catch (err) { qs("#auth-error").textContent = err.message; btn.disabled = false; }
    });
  };
  draw();
}

/* ---------- Home / dashboard ---------- */
async function homePage() {
  const [d, m] = await Promise.all([api("/profile/dashboard"), api("/profile/mentor")]);
  app.innerHTML = `
    <section class="card hero split"><div>
      <h1>Welcome back, ${esc(d.user.name)} 👋</h1>
      <p class="muted">Level ${d.user.level} Explorer</p>
      <div class="xpbar" role="progressbar" aria-valuenow="${d.user.xp_into_level}" aria-valuemin="0" aria-valuemax="100"><span style="width:${d.user.xp_into_level}%"></span></div>
      <small class="muted">${d.user.xp_into_level}/100 XP to the next level · ${d.user.xp} XP total</small></div>
      <div class="stats"><div class="stat"><b>🔥 ${d.user.streak}</b><small>day streak</small></div>
      <div class="stat"><b>⚗️ ${d.elements_collected}/${d.elements_total}</b><small>elements</small></div>
      <div class="stat"><b>🔁 ${d.due_count}</b><small>revisions due</small></div></div></section>
    <section class="card"><h2>🤖 Quiz Mentor</h2>
      <p class="muted">A rule-based coach that studies your answers. It runs on our own server - no outside AI service.</p>
      ${m.tips.map((t) => `<div class="tip"><span class="emoji">${esc(t.emoji)}</span><div><b>${esc(t.title)}</b><p>${esc(t.text)}</p><a class="btn small" href="${esc(t.href)}">${esc(t.label)}</a></div></div>`).join("")}</section>
    <div class="grid2">
      <section class="card"><h2>Recent quests</h2>${d.recent.length ? `<ul class="list">${d.recent.map((a) => `<li><span>${esc(a.title)}</span><span>${a.percent}% <span style="color:var(--gold)">${starsText(a.stars)}</span></span></li>`).join("")}</ul>` : `<p class="muted">No quests yet. Open the map and begin!</p>`}</section>
      <section class="card"><h2>Achievements</h2>${d.badges.length ? d.badges.map((b) => `<span class="badge-pill" title="${esc(b.description)}">${esc(b.emoji)} ${esc(b.title)}</span>`).join("") : `<p class="muted">Finish a quiz to earn your first badge.</p>`}</section>
    </div>`;
}

/* ---------- Adventure map ---------- */
async function mapPage() {
  const { worlds } = await api("/profile/adventure");
  app.innerHTML = `<section class="card"><h1>🗺️ Adventure Map</h1><p class="muted">Each subject is a world. Clear a level (60%+) to unlock the next one.</p></section>` +
    worlds.map((w) => `<section class="card world" style="--world:${esc(w.color)}"><h2>${esc(w.emoji)} ${esc(w.name)} World</h2><p class="muted">${esc(w.description)}</p>
      ${w.topics.map((t) => `<div class="topic"><div class="row between"><h3>${esc(t.name)}</h3>${t.levels.length ? `<button class="btn small green" data-adaptive="${t.id}">🧠 Adaptive practice</button>` : ""}</div>
        ${t.levels.length ? `<div class="levels">${t.levels.map((l) => `<button class="level" data-quiz="${l.id}" ${l.locked ? "disabled" : ""} aria-label="Level ${l.level_no}: ${esc(l.title)}${l.locked ? ", locked" : ""}">
          <div class="no">${l.locked ? "🔒" : l.level_no}</div><b>${esc(l.title)}</b><small>${l.questions} questions · ${l.time_limit_minutes} min</small>
          <div style="color:var(--gold)">${starsText(l.stars)}</div></button>`).join("")}</div>` : `<p class="muted">No levels yet.</p>`}</div>`).join("")}</section>`).join("");
  qsa("[data-quiz]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/quiz/${b.dataset.quiz}`; }));
  qsa("[data-adaptive]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/adaptive/${b.dataset.adaptive}`; }));
}

/* ---------- Level quiz (timed, with confidence) ---------- */
async function quizPage([, id]) {
  const data = await api(`/quizzes/${id}/start`, "POST");
  const questions = data.questions;
  const answers = {}; // question_id -> {selected, confidence}
  let i = 0, left = data.quiz.time_limit_minutes * 60, submitting = false;

  const submit = async (auto) => {
    if (submitting) return;
    const unanswered = questions.filter((q) => !answers[q.id] || !answers[q.id].selected).length;
    if (!auto && unanswered && !confirm(`You left ${unanswered} question(s) unanswered. Finish anyway?`)) return;
    submitting = true; clearInterval(timer);
    try {
      const res = await api(`/attempts/${data.attempt_id}/submit`, "POST", {
        answers: questions.map((q) => ({ question_id: q.id, selected_option: answers[q.id]?.selected || null, confidence: answers[q.id]?.confidence || "unsure" })),
      });
      resultView(res);
    } catch (err) { toast(err.message, "error"); submitting = false; if (err.status === 400 || err.status === 409) location.hash = "#/map"; }
  };

  const draw = () => {
    const q = questions[i], a = answers[q.id] || {};
    app.innerHTML = `<section class="card"><div class="row between"><h2>${esc(data.quiz.title)}</h2><div class="timer" id="clock" aria-label="Time left">⏱ ${fmtTime(left)}</div></div>
      <div class="progress"><span style="width:${((i + 1) / questions.length) * 100}%"></span></div>
      <p class="muted">Question ${i + 1} of ${questions.length} · +4 correct, −1 wrong, 0 skipped</p>
      <h3 class="qtext">${esc(q.text)}</h3><div class="opts">${optionButtons(q, a.selected)}</div>${confidenceButtons(a.confidence)}
      <div class="row between"><button class="btn ghost" id="prev" ${i === 0 ? "disabled" : ""}>← Back</button>
      ${i < questions.length - 1 ? `<button class="btn" id="next">Next →</button>` : `<button class="btn gold" id="finish">Finish quest 🏁</button>`}</div></section>`;
    qsa(".opt").forEach((b) => b.addEventListener("click", () => { const cur = answers[q.id] || {}; answers[q.id] = { ...cur, selected: cur.selected === b.dataset.opt ? null : b.dataset.opt }; draw(); }));
    qsa("[data-conf]").forEach((b) => b.addEventListener("click", () => { answers[q.id] = { ...(answers[q.id] || {}), confidence: b.dataset.conf }; draw(); }));
    qs("#prev").onclick = () => { i--; draw(); };
    if (qs("#next")) qs("#next").onclick = () => { i++; draw(); };
    if (qs("#finish")) qs("#finish").onclick = () => submit(false);
  };
  draw();
  timer = setInterval(() => {
    left--;
    const c = qs("#clock"); if (c) c.textContent = "⏱ " + fmtTime(Math.max(left, 0));
    if (left <= 0) { toast("Time is up! Submitting...", "info"); submit(true); }
  }, 1000);
}

function resultView(r) {
  app.innerHTML = `<section class="card"><h1 class="center">${r.passed ? "Level cleared! 🎉" : "Keep going! 💪"}</h1>
    <div class="stars" style="color:var(--gold)" aria-label="${r.stars} stars">${starsText(r.stars)}</div>
    <div class="bigscore">${r.score}/${r.max_score}</div>
    <p class="center muted">${r.percent}% · ${r.correct} correct · ${r.wrong} wrong · ${r.unanswered} skipped · pass mark ${r.pass_percent}%</p>
    <p class="center">+${r.xp_earned} XP</p>${elementsHtml(r.new_elements)}${badgesHtml(r.new_badges)}
    ${r.certificate && r.certificate.is_new ? `<p class="center">🎓 Certificate unlocked! <a class="btn gold small" href="#/certificate/${esc(r.certificate.code)}">View certificate</a></p>` : ""}
    <div class="row" style="justify-content:center"><a class="btn" href="#/map">Back to map</a><a class="btn ghost" href="#/revision">Revision cards</a></div></section>
    <section class="card"><h2>Answer review</h2><p class="muted">Confidence tracking: 😎 sure · 🤔 not sure · 🎲 guess</p><div class="review">${r.review.map((x, n) => `<article class="${x.is_correct ? "ok" : ""}">
      <b>${n + 1}. ${esc(x.text)}</b>
      <p>Your answer: <b>${x.selected ? esc(x.selected + ". " + x.options[x.selected]) : "Skipped"}</b> (${esc(x.confidence)})<br>Correct: <b>${esc(x.correct_option + ". " + x.options[x.correct_option])}</b></p>
      <p class="muted">${esc(x.explanation)}</p>${x.insight ? `<p>💡 ${esc(x.insight)}</p>` : ""}</article>`).join("")}</div></section>`;
}

/* ---------- Adaptive practice ---------- */
async function adaptivePage([, topicId]) {
  const start = await api("/adaptive/start", "POST", { topic_id: Number(topicId) });
  let q = start.question, answered = 0, difficulty = start.difficulty, picked = null, conf = null, locked = false, last = null;

  const draw = () => {
    app.innerHTML = `<section class="card"><div class="row between"><h2>🧠 Adaptive: ${esc(start.topic)}</h2><span class="chip">Level ${"⭐".repeat(difficulty)}</span></div>
      <div class="progress"><span style="width:${(answered / start.length) * 100}%"></span></div>
      <p class="muted">Question ${answered + 1} of up to ${start.length} · right answers make the next question harder</p>
      <h3 class="qtext">${esc(q.text)}</h3><div class="opts">${optionButtons(q, picked, locked)}</div>
      ${locked ? `<div class="feedback ${last.feedback.is_correct ? "good" : "bad"}"><b>${last.feedback.is_correct ? "Correct! ✅" : "Not quite ❌"}</b> (${last.feedback.marks > 0 ? "+" : ""}${last.feedback.marks})<p>${esc(last.feedback.explanation)}</p>${last.feedback.insight ? `<p>💡 ${esc(last.feedback.insight)}</p>` : ""}${elementsHtml(last.feedback.new_elements)}</div>
        <p><button class="btn gold" id="next">${last.finished ? "See my results" : "Next question →"}</button></p>`
        : `${confidenceButtons(conf)}<button class="btn" id="lock" ${picked ? "" : "disabled"}>Lock in answer</button>`}</section>`;
    if (locked) reveal(app, picked, last.feedback.correct_option);
    qsa(".opt").forEach((b) => b.addEventListener("click", () => { if (!locked) { picked = b.dataset.opt; draw(); } }));
    qsa("[data-conf]").forEach((b) => b.addEventListener("click", () => { conf = b.dataset.conf; draw(); }));
    if (qs("#lock")) qs("#lock").onclick = (e) => guarded(e.target, async () => {
      last = await api(`/adaptive/${start.attempt_id}/answer`, "POST", { question_id: q.id, selected_option: picked, confidence: conf || "unsure" });
      locked = true; draw();
    });
    if (qs("#next")) qs("#next").onclick = () => {
      if (last.finished) return adaptiveSummary(last.summary, topicId);
      q = last.next_question; answered = last.answered; difficulty = last.difficulty; picked = null; conf = null; locked = false; draw();
    };
  };
  draw();
}

function adaptiveSummary(s, topicId) {
  app.innerHTML = `<section class="card"><h1 class="center">Practice complete! 🧠</h1><div class="bigscore">${s.percent}%</div>
    <p class="center muted">${s.correct} correct · ${s.wrong} wrong · score ${s.score}/${s.max_score}</p><p class="center">+${s.xp_earned} XP</p>${badgesHtml(s.new_badges)}
    <div class="row" style="justify-content:center"><a class="btn" href="#/adaptive/${esc(topicId)}">Practice again</a><a class="btn ghost" href="#/map">Back to map</a></div></section>`;
}

/* ---------- Smart revision ---------- */
async function revisionPage() {
  const { cards } = await api("/revision/due");
  if (!cards.length) {
    app.innerHTML = `<section class="card center"><h1>All caught up! 🎉</h1><p class="muted">Wrong answers and lucky guesses appear here on a schedule (1, 3, 7, 14 and 30 days).</p><a class="btn" href="#/map">Go on a quest</a></section>`;
    return;
  }
  let n = 0, picked = null, result = null, right = 0;
  const draw = () => {
    if (n >= cards.length) {
      app.innerHTML = `<section class="card center"><h1>Revision done! 🔁</h1><p>${right} of ${cards.length} correct.</p><a class="btn" href="#/home">Home</a></section>`;
      return;
    }
    const c = cards[n];
    app.innerHTML = `<section class="card"><h2>🔁 Revision card ${n + 1} of ${cards.length}</h2><p class="muted">Box ${c.box} of 5 - correct answers move the card to a longer wait.</p>
      <h3 class="qtext">${esc(c.question.text)}</h3><div class="opts">${optionButtons(c.question, picked, !!result)}</div>
      ${result ? `<div class="feedback ${result.is_correct ? "good" : "bad"}"><b>${result.is_correct ? "Correct! ✅" : "Not yet ❌"}</b><p>${esc(result.explanation)}</p><p class="muted">Next review: ${fmtDate(result.next_due)}</p></div><p><button class="btn gold" id="next">Next →</button></p>` : ""}</section>`;
    if (result) reveal(app, picked, result.correct_option);
    qsa(".opt").forEach((b) => b.addEventListener("click", () => guarded(null, async () => {
      if (result) return;
      picked = b.dataset.opt;
      result = await api(`/revision/${c.id}/answer`, "POST", { selected_option: picked });
      if (result.is_correct) right++;
      draw();
    })));
    if (qs("#next")) qs("#next").onclick = () => { n++; picked = null; result = null; draw(); };
  };
  draw();
}

/* ---------- Live quiz battle (polling) ---------- */
async function battleHome() {
  const { worlds } = await api("/profile/adventure");
  const quizzes = worlds.flatMap((w) => w.topics.flatMap((t) => t.levels.map((l) => ({ id: l.id, label: `${w.name} › ${t.name} › L${l.level_no}: ${l.title}` }))));
  app.innerHTML = `<section class="card"><h1>⚔️ Live Quiz Battle</h1><p class="muted">Host a room, share the 6-letter code, and everyone races on the same questions. Faster correct answers earn more points.</p></section>
    <div class="grid2"><section class="card"><h2>Host a battle</h2>
      ${quizzes.length ? `<form id="create-form"><label>Quiz<select name="quiz_id">${quizzes.map((q) => `<option value="${q.id}">${esc(q.label)}</option>`).join("")}</select></label>
      <label>Seconds per question<input name="seconds_per_question" type="number" min="10" max="60" value="20"></label><button class="btn gold" type="submit">Create room</button></form>` : `<p class="muted">No quizzes available yet.</p>`}</section>
    <section class="card"><h2>Join a battle</h2><form id="join-form"><label>Room code<input name="code" maxlength="6" minlength="6" required autocomplete="off" style="text-transform:uppercase" placeholder="ABC123"></label><button class="btn" type="submit">Join room</button></form></section></div>`;
  const create = qs("#create-form");
  if (create) create.addEventListener("submit", (e) => { e.preventDefault(); guarded(qs("button", create), async () => {
    const f = Object.fromEntries(new FormData(create));
    const r = await api("/battles", "POST", { quiz_id: Number(f.quiz_id), seconds_per_question: Number(f.seconds_per_question) });
    location.hash = `#/battle/${r.code}`;
  }); });
  const join = qs("#join-form");
  join.addEventListener("submit", (e) => { e.preventDefault(); guarded(qs("button", join), async () => {
    const r = await api("/battles/join", "POST", { code: new FormData(join).get("code") });
    location.hash = `#/battle/${r.code}`;
  }); });
}

async function battleRoom([, code]) {
  let st = null, lastKey = "", result = null, resultIndex = -1;
  const board = () => `<ol class="list">${st.players.map((p, n) => `<li><span>${n + 1}. ${esc(p.name)}</span><b>${p.score}</b></li>`).join("")}</ol>`;

  const draw = () => {
    if (st.status === "waiting") {
      app.innerHTML = `<section class="card"><h1 class="center">Battle lobby ⚔️</h1><p class="center muted">Share this code with your friends:</p><div class="code-big" aria-label="Room code">${esc(st.code)}</div>
        <h2>Players (${st.players.length})</h2><div id="board">${board()}</div>
        ${st.is_host ? `<p class="center"><button class="btn gold" id="start">Start battle!</button></p>` : `<p class="center muted">Waiting for the host to start...</p>`}</section>`;
      if (qs("#start")) qs("#start").onclick = (e) => guarded(e.target, async () => { await api(`/battles/${code}/start`, "POST"); await tick(); });
    } else if (st.status === "live") {
      const q = st.question;
      app.innerHTML = `<section class="card"><div class="row between"><h2>Question ${q.index + 1} of ${st.total}</h2><div class="timer" id="bt-time">⏱ ${q.seconds_left}s</div></div>
        <h3 class="qtext">${esc(q.text)}</h3><div class="opts">${optionButtons(q, null, st.answered)}</div>
        ${st.answered ? `<div class="feedback ${result && resultIndex === q.index && result.is_correct ? "good" : ""}">${result && resultIndex === q.index ? `<b>${result.is_correct ? "Correct! +" + result.points : "Wrong answer, +0"}</b><p>${esc(result.explanation)}</p>` : "<b>Answer locked.</b>"}<p class="muted">Waiting for the next question...</p></div>` : ""}
        </section><section class="card"><h2>Leaderboard</h2><div id="board">${board()}</div></section>`;
      if (st.answered && result && resultIndex === q.index) reveal(app, null, result.correct_option);
      if (!st.answered) qsa(".opt").forEach((b) => b.addEventListener("click", () => guarded(null, async () => {
        result = await api(`/battles/${code}/answer`, "POST", { selected_option: b.dataset.opt });
        resultIndex = q.index;
        await tick();
      })));
    } else {
      clearInterval(timer);
      app.innerHTML = `<section class="card"><h1 class="center">Battle finished! 🏆</h1>${st.players.length ? `<p class="center">Winner: <b>${esc(st.players[0].name)}</b> with ${st.players[0].score} points</p>` : ""}${board()}
        <p class="center"><a class="btn" href="#/battle">New battle</a></p></section>`;
    }
  };

  const tick = async () => {
    try { st = await api(`/battles/${code}`); }
    catch (err) { clearInterval(timer); app.innerHTML = `<section class="card error-box"><h2>${esc(err.message)}</h2><a class="btn" href="#/battle">Back</a></section>`; return; }
    const key = `${st.status}:${st.question ? st.question.index : "-"}:${st.answered}:${st.status === "waiting" ? st.players.length : ""}`;
    if (key !== lastKey) { lastKey = key; draw(); return; }
    const t = qs("#bt-time"); if (t && st.question) t.textContent = `⏱ ${st.question.seconds_left}s`;
    const b = qs("#board"); if (b) b.innerHTML = board();
  };
  await tick();
  timer = setInterval(tick, 1500);
}

/* ---------- Collection (periodic table + badges) ---------- */
const periodicPosition = (z) => {
  if (z === 1) return [1, 1];
  if (z === 2) return [1, 18];
  if (z <= 4) return [2, z - 2];
  if (z <= 10) return [2, z + 8];
  if (z <= 12) return [3, z - 10];
  if (z <= 18) return [3, z];
  return [4, z - 18];
};
async function collectionPage() {
  const { elements, badges } = await api("/profile/collection");
  const got = elements.filter((e) => e.collected).length;
  app.innerHTML = `<section class="card"><h1>⚗️ Element Collection</h1><p class="muted">Answer a question correctly to collect its element card. ${got} of ${elements.length} collected.</p>
    <div class="ptable-wrap"><div class="ptable" role="list">${elements.map((e) => { const [r, c] = periodicPosition(e.atomic_number);
      return `<div class="el cat-${esc(e.category.toLowerCase().replace(/\s+/g, "-"))} ${e.collected ? "got" : ""}" role="listitem" style="grid-row:${r};grid-column:${c}" title="${e.collected ? esc(e.name + " - " + e.category) : "Locked"}"><span><small>${e.atomic_number}</small><b>${esc(e.symbol)}</b></span></div>`; }).join("")}</div></div></section>
    <section class="card"><h2>🏅 Badges</h2><div class="grid2">${badges.map((b) => `<div class="tip" style="opacity:${b.earned ? 1 : 0.45}"><span class="emoji">${esc(b.emoji)}</span><div><b>${esc(b.title)}</b><p>${esc(b.description)}${b.earned ? " ✅" : ""}</p></div></div>`).join("")}</div></section>`;
}

/* ---------- Certificates ---------- */
async function certificatesPage() {
  const { certificates } = await api("/certificates");
  app.innerHTML = `<section class="card"><h1>🎓 My Certificates</h1>${certificates.length ? `<ul class="list">${certificates.map((c) => `<li><span><b>${esc(c.quiz)}</b><br><small class="muted">${esc(c.topic)} · ${fmtDate(c.issued_at)}</small></span><span>${c.percent}% <a class="btn small" href="#/certificate/${esc(c.code)}">Open</a></span></li>`).join("")}</ul>` : `<p class="muted">Pass any level to earn an instant certificate.</p><a class="btn" href="#/map">Open the map</a>`}</section>`;
}
async function certificatePage([, code]) {
  const c = await api(`/certificates/${encodeURIComponent(code)}`);
  app.innerHTML = `<section class="certificate"><h1>Certificate of Achievement</h1><p>This is proudly presented to</p><div class="who">${esc(c.student)}</div>
    <p>for successfully completing <b>${esc(c.quiz)}</b><br>(${esc(c.topic)}) with a score of <b>${c.percent}%</b></p>
    <p>Issued on ${fmtDate(c.issued_at)}<br><small>Certificate ID: ${esc(c.code)}</small></p><p>⚡ NEET Quest</p></section>
    <p class="center no-print"><button class="btn gold" id="print">Print / Save as PDF</button> <a class="btn ghost" href="#/certificates">Back</a></p>`;
  qs("#print").onclick = () => window.print();
}

/* ---------- Instructor ---------- */
async function instructorPage() {
  const [{ subjects }, { quizzes }] = await Promise.all([api("/instructor/topics"), api("/instructor/quizzes")]);
  app.innerHTML = `<section class="card"><h1>🧑‍🏫 Instructor Studio</h1><p class="muted">Create levels for the adventure map, then add questions to them. You can edit only quizzes you created.</p></section>
    <div class="grid2"><section class="card"><h2>New quiz (level)</h2><form id="quiz-form">
      <label>Topic<select name="topic_id">${subjects.map((s) => `<optgroup label="${esc(s.name)}">${s.topics.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</optgroup>`).join("")}</select></label>
      <label>Title<input name="title" required minlength="3" maxlength="80"></label>
      <div class="form-grid"><label>Level no.<input name="level_no" type="number" min="1" max="50" value="1" required></label>
      <label>Minutes<input name="time_limit_minutes" type="number" min="1" max="120" value="10"></label>
      <label>Pass %<input name="pass_percent" type="number" min="1" max="100" value="60"></label></div>
      <button class="btn gold" type="submit">Create quiz</button></form></section>
    <section class="card"><h2>All quizzes</h2><ul class="list">${quizzes.map((q) => `<li><span>${esc(q.topic)} · L${q.level_no}: <b>${esc(q.title)}</b><br><small class="muted">${q.questions} questions</small></span><a class="btn small ${q.mine ? "" : "ghost"}" href="#/instructor/quiz/${q.id}">${q.mine ? "Manage" : "View"}</a></li>`).join("") || "<li>No quizzes yet.</li>"}</ul></section></div>`;
  const form = qs("#quiz-form");
  form.addEventListener("submit", (e) => { e.preventDefault(); guarded(qs("button", form), async () => {
    const f = Object.fromEntries(new FormData(form));
    const r = await api("/instructor/quizzes", "POST", { ...f, topic_id: Number(f.topic_id), level_no: Number(f.level_no), time_limit_minutes: Number(f.time_limit_minutes), pass_percent: Number(f.pass_percent) });
    toast("Quiz created! Now add questions.", "success");
    location.hash = `#/instructor/quiz/${r.id}`;
  }); });
}

async function instructorQuizPage([, id]) {
  const { quiz, questions, stats } = await api(`/instructor/quizzes/${id}`);
  app.innerHTML = `<section class="card"><a href="#/instructor">← All quizzes</a><h1>${esc(quiz.title)}</h1>
    <p class="muted">${esc(quiz.topic)} · Level ${quiz.level_no} · ${quiz.time_limit_minutes} min · pass ${quiz.pass_percent}%</p>
    <p>📊 ${stats.attempts} attempts · average ${stats.average_percent === null ? "-" : stats.average_percent + "%"}</p>
    ${quiz.mine ? `<button class="btn red small" id="del-quiz">Delete this quiz</button>` : `<p class="muted">You can view this quiz but not edit it.</p>`}</section>
    ${quiz.mine ? `<section class="card"><h2>Add a question</h2><form id="q-form"><label>Question<textarea name="question_text" rows="2" required minlength="5" maxlength="500"></textarea></label>
      <div class="form-grid">${["a", "b", "c", "d"].map((k) => `<label>Option ${k.toUpperCase()}<input name="option_${k}" required maxlength="200"></label>`).join("")}</div>
      <div class="form-grid"><label>Correct option<select name="correct_option">${OPT.map((k) => `<option>${k}</option>`).join("")}</select></label>
      <label>Difficulty<select name="difficulty"><option value="1">1 - Easy</option><option value="2" selected>2 - Medium</option><option value="3">3 - Hard</option></select></label>
      <label>Element no. (optional, 1-36)<input name="element_number" type="number" min="1" max="36"></label></div>
      <label>Explanation<textarea name="explanation" rows="2" maxlength="500"></textarea></label><button class="btn gold" type="submit">Add question</button></form></section>` : ""}
    <section class="card"><h2>Questions (${questions.length})</h2><div class="review">${questions.map((q, n) => `<article class="ok"><b>${n + 1}. ${esc(q.question_text)}</b>
      <p>${["a", "b", "c", "d"].map((k) => `${k.toUpperCase()}. ${esc(q["option_" + k])}${q.correct_option === k.toUpperCase() ? " ✅" : ""}`).join("<br>")}</p>
      <small class="muted">Difficulty ${q.difficulty}${q.element_number ? " · element " + q.element_number : ""}</small>
      ${quiz.mine ? ` <button class="btn red small" data-del="${q.id}">Delete</button>` : ""}</article>`).join("") || `<p class="muted">No questions yet.</p>`}</div></section>`;
  const qf = qs("#q-form");
  if (qf) qf.addEventListener("submit", (e) => { e.preventDefault(); guarded(qs("button", qf), async () => {
    const f = Object.fromEntries(new FormData(qf));
    await api(`/instructor/quizzes/${id}/questions`, "POST", { ...f, difficulty: Number(f.difficulty), element_number: f.element_number ? Number(f.element_number) : null });
    toast("Question added", "success");
    await instructorQuizPage([null, id]);
  }); });
  qsa("[data-del]").forEach((b) => b.addEventListener("click", () => { if (confirm("Delete this question? This cannot be undone.")) guarded(b, async () => { await api(`/instructor/questions/${b.dataset.del}`, "DELETE"); await instructorQuizPage([null, id]); }); }));
  const dq = qs("#del-quiz");
  if (dq) dq.onclick = () => { if (confirm("Delete the whole quiz and all its questions? This cannot be undone.")) guarded(dq, async () => { await api(`/instructor/quizzes/${id}`, "DELETE"); location.hash = "#/instructor"; }); };
}

/* ---------- Router ---------- */
const routes = [
  [/^#\/?$/, authPage, "public"],
  [/^#\/home$/, homePage, "auth"],
  [/^#\/map$/, mapPage, "auth"],
  [/^#\/quiz\/(\d+)$/, quizPage, "auth"],
  [/^#\/adaptive\/(\d+)$/, adaptivePage, "auth"],
  [/^#\/revision$/, revisionPage, "auth"],
  [/^#\/battle$/, battleHome, "auth"],
  [/^#\/battle\/([A-Za-z0-9]{6})$/, (m) => battleRoom([m[0], m[1].toUpperCase()]), "auth"],
  [/^#\/collection$/, collectionPage, "auth"],
  [/^#\/certificates$/, certificatesPage, "auth"],
  [/^#\/certificate\/(NQ-[A-Fa-f0-9]{10})$/, certificatePage, "public"],
  [/^#\/instructor$/, instructorPage, "instructor"],
  [/^#\/instructor\/quiz\/(\d+)$/, instructorQuizPage, "instructor"],
];

async function route() {
  clearInterval(timer);
  if (me === undefined) { try { me = (await api("/auth/me")).user; } catch { me = null; } }
  const hash = location.hash || "#/";
  const found = routes.find(([re]) => re.test(hash));
  renderNav();
  if (!found) { app.innerHTML = `<section class="card center"><h1>Page not found 🛰️</h1><a class="btn" href="#/">Back to start</a></section>`; return; }
  const [re, handler, access] = found;
  if (access !== "public" && !me) { location.hash = "#/"; return; }
  if (access === "instructor" && me.role !== "instructor") { location.hash = "#/home"; return; }
  window.scrollTo(0, 0);
  try { await handler(hash.match(re)); }
  catch (err) {
    if (err.status === 401) { me = null; location.hash = "#/"; return; }
    app.innerHTML = `<section class="card error-box"><h2>Oops! 😕</h2><p>${esc(err.message)}</p><a class="btn" href="#/home">Back home</a></section>`;
  }
}
window.addEventListener("hashchange", route);
route();
