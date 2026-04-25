const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-change-me";

async function authMiddleware(req, res, next) {
  const token = req.cookies ? req.cookies.token : null;

  if (!token) {
    req.user = null;
    res.locals.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // 🔥 FETCH REAL USER FROM DB
    const user = await User.findById(decoded.id);

    if (!user) {
      req.user = null;
      res.locals.user = null;
      return next();
    }

    req.user = user;            // FULL USER OBJECT
    res.locals.user = user;     // for EJS

  } catch (err) {
    req.user = null;
    res.locals.user = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect("/login");
  }
  next();
}

module.exports = {
  authMiddleware,
  requireAuth,
  JWT_SECRET
};