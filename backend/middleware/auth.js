const jwt = require("jsonwebtoken");
const supabase = require("../supabase");

// Reads the JWT from the httpOnly cookie, then loads the CURRENT user (and role) from the database.
// The role is never taken from the browser.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ error: "Please log in first." });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Your session has expired. Please log in again." });
    }

    const { data, error } = await supabase.from("users").select("id,name,email,role").eq("id", payload.sub).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(401).json({ error: "Account not found." });

    req.user = data;
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "You do not have permission to do this." });

module.exports = { requireAuth, requireRole };
