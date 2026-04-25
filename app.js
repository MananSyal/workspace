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

const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

const Project = require("./models/Project");
const Task = require("./models/Task");
const User = require("./models/User");

const { authMiddleware, requireAuth, JWT_SECRET } = require("./middleware/auth");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static(path.join(__dirname, "public")));

app.use(authMiddleware);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// ================= AUTH =================

app.get("/register", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("register", { layout: "auth-layout", error: null });
});

app.post("/register", async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !email || !password) {
    return res.render("register", { layout: "auth-layout", error: "All fields required" });
  }

  if (password !== confirmPassword) {
    return res.render("register", { layout: "auth-layout", error: "Passwords do not match" });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.render("register", { layout: "auth-layout", error: "Email already exists" });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash: hash });

  const token = jwt.sign({ id: user._id }, JWT_SECRET);
  res.cookie("token", token, { httpOnly: true });

  res.redirect("/");
});

app.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { layout: "auth-layout", error: null });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return res.render("login", { layout: "auth-layout", error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.render("login", { layout: "auth-layout", error: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user._id }, JWT_SECRET);
  res.cookie("token", token, { httpOnly: true });

  res.redirect("/");
});

app.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

// ================= DASHBOARD =================

app.get("/", requireAuth, async (req, res) => {
  const projects = await Project.find({ userId: req.user._id });
  const tasks = await Task.find({ userId: req.user._id });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;

  const overallCompletion = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  res.render("dashboard", {
    totalProjects: projects.length,
    totalTasks,
    overallCompletion
  });
});

// ================= PROJECTS =================

app.get("/projects", requireAuth, async (req, res) => {
  const projects = await Project.find({ userId: req.user._id });

  const updatedProjects = await Promise.all(
    projects.map(async (project) => {
      const tasks = await Task.find({
        projectId: project._id,
        userId: req.user._id
      });

      const total = tasks.length;
      const completed = tasks.filter(t => t.completed).length;

      const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

      return {
        id: project._id,
        name: project.title,
        description: project.description,
        progress
      };
    })
  );

  res.render("projects", { projects: updatedProjects });
});

app.get("/projects/new", requireAuth, (req, res) => {
  res.render("new-project", { error: null });
});

app.post("/projects", requireAuth, async (req, res) => {
  const title = req.body.title || req.body.name;

  await Project.create({
    title,
    description: req.body.description,
    userId: req.user._id
  });

  res.redirect("/projects");
});

app.get("/projects/:id", requireAuth, async (req, res) => {
  const project = await Project.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!project) return res.send("Project not found");

  const tasks = await Task.find({
    projectId: project._id,
    userId: req.user._id
  });

  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;

  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  res.render("project-detail", {
    project: {
      id: project._id,
      name: project.title,
      description: project.description,
      progress
    },
    tasks
  });
});

// ================= TASKS =================

app.post("/projects/:id/tasks", requireAuth, async (req, res) => {
  await Task.create({
  title: req.body.title,
  projectId: req.params.id,
  userId: req.user._id
});
  res.redirect(`/projects/${req.params.id}`);
});

app.get("/tasks", requireAuth, async (req, res) => {
  const tasks = await Task.find({ userId: req.user._id }).populate("projectId");

  const formattedTasks = tasks.map(t => ({
    id: t._id,
    title: t.title,
    completed: t.completed,
    projectTitle: t.projectId ? t.projectId.title : "Unknown"
  }));

  res.render("tasks", { tasks: formattedTasks });
});

app.post("/tasks/:id/toggle", requireAuth, async (req, res) => {
  const task = await Task.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!task) return res.send("Task not found");

  task.completed = !task.completed;
  await task.save();

  res.redirect("back");
});

// ================= ERROR =================

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("Server Error");
});

// ================= START =================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});