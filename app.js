// app.js - Workspace Manager (Auth + EJS + WebSockets)

const path = require("path");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");
const expressLayouts = require("express-ejs-layouts");

dotenv.config();

// =======================
// MongoDB Connection
// =======================
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined");
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// =======================
// Models
// =======================
const Project = require("./models/Project");
const Task = require("./models/Task");
const User = require("./models/User");

// =======================
// Auth Middleware
// =======================
const {
  authMiddleware,
  requireAuth,
  JWT_SECRET
} = require("./middleware/auth");

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET is not defined");
  process.exit(1);
}

// =======================
// Express + HTTP Server
// =======================
const app = express();
const server = http.createServer(app);

// =======================
// WebSocket Server
// =======================
const wss = new WebSocketServer({ server });

// =======================
// Helpers
// =======================
async function computeStats() {
  const [projects, tasks] = await Promise.all([
    Project.find(),
    Task.find()
  ]);

  const totalProjects = projects.length;
  const totalTasks = tasks.length;

  let overallCompletion = 0;
  if (totalTasks > 0) {
    const completedTasks = tasks.filter(t => t.completed).length;
    overallCompletion = Math.round(
      (completedTasks / totalTasks) * 100
    );
  }

  const formattedProjects = projects.map(p => ({
    id: p._id,
    name: p.title,
    description: p.description,
    progress: p.progress || 0
  }));

  return {
    totalProjects,
    totalTasks,
    overallCompletion,
    projects: formattedProjects
  };
}

async function broadcastStats() {
  const stats = await computeStats();
  const message = JSON.stringify({ type: "stats", data: stats });

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

wss.on("connection", async ws => {
  console.log("🔌 WebSocket client connected");

  ws.send(JSON.stringify({
    type: "info",
    message: "Connected to live updates"
  }));

  const stats = await computeStats();
  ws.send(JSON.stringify({ type: "stats", data: stats }));
});

// =======================
// Express Middleware
// =======================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static(path.join(__dirname, "public")));

// Attach user if logged in
app.use(authMiddleware);

// For active nav highlighting
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// =======================
// Auth Routes
// =======================
app.get("/register", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("register", { layout: "auth-layout", error: null });
});
// =======================
// Tasks Page
// =======================
app.get("/tasks", requireAuth, async (req, res, next) => {
  try {
    const tasks = await Task.find().populate("projectId");

    const formattedTasks = tasks.map(task => ({
      id: task._id,
      title: task.title,
      completed: task.completed,
      projectTitle: task.projectId
        ? task.projectId.title
        : "Unknown"
    }));

    res.render("tasks", { tasks: formattedTasks });
  } catch (err) {
    next(err);
  }
});

app.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      return res.render("register", {
        layout: "auth-layout",
        error: "All fields are required."
      });
    }

    if (password !== confirmPassword) {
      return res.render("register", {
        layout: "auth-layout",
        error: "Passwords do not match."
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.render("register", {
        layout: "auth-layout",
        error: "Email already registered."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { layout: "auth-layout", error: null });
});

app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.render("login", {
        layout: "auth-layout",
        error: "Invalid email or password."
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.render("login", {
        layout: "auth-layout",
        error: "Invalid email or password."
      });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, { httpOnly: true });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// =======================
// Protected Routes
// =======================
app.get("/", requireAuth, async (req, res, next) => {
  try {
    const stats = await computeStats();
    res.render("dashboard", stats);
  } catch (err) {
    next(err);
  }
});

app.get("/projects", requireAuth, async (req, res, next) => {
  try {
    const projects = await Project.find();
    res.render("projects", {
      projects: projects.map(p => ({
        id: p._id,
        name: p.title,
        description: p.description,
        progress: p.progress || 0
      }))
    });
  } catch (err) {
    next(err);
  }
});

app.get("/projects/new", requireAuth, (req, res) => {
  res.render("new-project", { error: null });
});

app.post("/projects", requireAuth, async (req, res, next) => {
  try {
    const title = req.body.title || req.body.name;
    if (!title) {
      return res.render("new-project", {
        error: "Project name is required."
      });
    }

    await Project.create({
      title,
      description: req.body.description,
      progress: 0
    });

    await broadcastStats();
    res.redirect("/projects");
  } catch (err) {
    next(err);
  }
});

app.get("/projects/:id", requireAuth, async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) throw new Error("Project not found");

    const tasks = await Task.find({ projectId: project._id });

    res.render("project-detail", {
      project: {
        id: project._id,
        name: project.title,
        description: project.description,
        progress: project.progress || 0
      },
      tasks
    });
  } catch (err) {
    next(err);
  }
});

app.post("/projects/:id/tasks", requireAuth, async (req, res, next) => {
  try {
    if (!req.body.title) throw new Error("Task title required");

    await Task.create({
      title: req.body.title,
      projectId: req.params.id
    });

    await broadcastStats();
    res.redirect(`/projects/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

app.post("/tasks/:id/toggle", requireAuth, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    task.completed = !task.completed;
    await task.save();

    await broadcastStats();
    res.redirect("back");
  } catch (err) {
    next(err);
  }
});

// =======================
// API Routes
// =======================
const apiProjectsRouter = require("./routes/api/projects");
app.use("/api/projects", requireAuth, apiProjectsRouter);

// =======================
// Error Handler
// =======================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { error: err });
});

// =======================
// Start Server
// =======================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
