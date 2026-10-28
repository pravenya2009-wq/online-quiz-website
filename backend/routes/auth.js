const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const supabase = require("../supabase");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const { isValidEmail, isValidPassword } = require("../utils/scoring");

const router = express.Router();

function setAuthCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true, // JavaScript in the browser cannot read it (protects against XSS theft)
    sameSite: "strict", // not sent on cross-site requests (protects against CSRF)
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// POST /api/auth/register
router.post("/register", asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const { password, role = "student", invite_code: inviteCode } = req.body;

  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: "Name must be 2 to 60 characters." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be 8+ characters with at least one letter and one number." });
  if (!["student", "instructor"].includes(role)) return res.status(400).json({ error: "Invalid role." });

  // Anyone can be a student. Instructors need the secret invite code from the server's .env file.
  if (role === "instructor" && (!process.env.INSTRUCTOR_INVITE_CODE || inviteCode !== process.env.INSTRUCTOR_INVITE_CODE)) {
    return res.status(403).json({ error: "Wrong instructor invite code." });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase.from("users").insert({ name, email, password_hash, role }).select("id,name,email,role").single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "This email is already registered." });
    throw error;
  }
  setAuthCookie(res, data.id);
  res.status(201).json({ user: data });
}));

// POST /api/auth/login
router.post("/login", asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const { data, error } = await supabase.from("users").select("id,name,email,role,password_hash").eq("email", email).maybeSingle();
  if (error) throw error;

  const ok = data && (await bcrypt.compare(password, data.password_hash));
  if (!ok) return res.status(401).json({ error: "Invalid email or password." });

  setAuthCookie(res, data.id);
  res.json({ user: { id: data.id, name: data.name, email: data.email, role: data.role } });
}));

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
