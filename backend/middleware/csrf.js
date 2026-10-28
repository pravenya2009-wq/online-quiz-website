// CSRF protection: cookies use SameSite=Strict AND every write request must carry a custom header.
// A malicious website cannot add custom headers to cross-site requests without our permission (CORS),
// so forged requests are rejected.
module.exports = function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") !== "quest-app") {
    return res.status(403).json({ error: "Blocked request (missing security header)." });
  }
  next();
};
