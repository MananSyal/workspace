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

// ================= DATABASE =================

const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

// ================= MODELS =================

const Project = require("./models/Project");
const Task = require("./models/Task");
const User = require("./models/User");
const Team = require("./models/Team");
const CodeSnippet = require("./models/CodeSnippet");
const ReviewComment = require("./models/ReviewComment");

// ================= AUTH =================

const {
  authMiddleware,
  requireAuth,
  JWT_SECRET
} = require("./middleware/auth");

// ================= APP =================

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

// =====================================================
// AUTH
// =====================================================

// REGISTER PAGE
app.get("/register", (req, res) => {

  if (req.user) return res.redirect("/");

  res.render("register", {
    layout: "auth-layout",
    error: null
  });

});

// REGISTER
app.post("/register", async (req, res) => {

  const {
    name,
    email,
    password,
    confirmPassword
  } = req.body;

  if (!name || !email || !password) {

    return res.render("register", {
      layout: "auth-layout",
      error: "All fields required"
    });

  }

  if (password !== confirmPassword) {

    return res.render("register", {
      layout: "auth-layout",
      error: "Passwords do not match"
    });

  }

  const existing = await User.findOne({ email });

  if (existing) {

    return res.render("register", {
      layout: "auth-layout",
      error: "Email already exists"
    });

  }

  const hash = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    email,
    passwordHash: hash
  });

  const token = jwt.sign(
    { id: user._id },
    JWT_SECRET
  );

  res.cookie("token", token, {
    httpOnly: true
  });

  res.redirect("/");

});

// LOGIN PAGE
app.get("/login", (req, res) => {

  if (req.user) return res.redirect("/");

  res.render("login", {
    layout: "auth-layout",
    error: null
  });

});

// LOGIN
app.post("/login", async (req, res) => {

  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user) {

    return res.render("login", {
      layout: "auth-layout",
      error: "Invalid credentials"
    });

  }

  const ok = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!ok) {

    return res.render("login", {
      layout: "auth-layout",
      error: "Invalid credentials"
    });

  }

  const token = jwt.sign(
    { id: user._id },
    JWT_SECRET
  );

  res.cookie("token", token, {
    httpOnly: true
  });

  res.redirect("/");

});

// LOGOUT
app.post("/logout", (req, res) => {

  res.clearCookie("token");

  res.redirect("/login");

});

// =====================================================
// TEAM ROUTES
// =====================================================

// CREATE TEAM PAGE
app.get("/teams/new", requireAuth, (req, res) => {

  res.render("new-team");

});

// CREATE TEAM
app.post("/teams/new", requireAuth, async (req, res) => {

  const { name } = req.body;

  await Team.create({

    name,

    owner: req.user._id,

    members: [req.user._id]

  });

  res.redirect("/teams");

});

// SHOW TEAMS
app.get("/teams", requireAuth, async (req, res) => {

  const teams = await Team.find({
    members: req.user._id
  }).populate("members");

  res.render("teams", { teams });

});

// ADD TEAM MEMBER
app.post("/teams/:id/add-member", requireAuth, async (req, res) => {

  const { email } = req.body;

  const team = await Team.findById(req.params.id);

  if (!team) {
    return res.send("Team not found");
  }

  const user = await User.findOne({ email });

  if (!user) {
    return res.send("User not found");
  }

  if (!team.members.includes(user._id)) {

    team.members.push(user._id);

    await team.save();

  }

  res.redirect("/teams");

});

// =====================================================
// DASHBOARD
// =====================================================

app.get("/", requireAuth, async (req, res) => {

  const projects = await Project.find({

    $or: [
      { userId: req.user._id },
      { sharedWith: req.user._id }
    ]

  });

  const tasks = await Task.find({});

  const totalTasks = tasks.length;

  const completedTasks = tasks.filter(
    t => t.completed
  ).length;

  const overallCompletion =
    totalTasks === 0
      ? 0
      : Math.round((completedTasks / totalTasks) * 100);

  res.render("dashboard", {

    totalProjects: projects.length,

    totalTasks,

    overallCompletion

  });

});

// =====================================================
// PROJECTS
// =====================================================

// ALL PROJECTS
app.get("/projects", requireAuth, async (req, res) => {

  const projects = await Project.find({

    $or: [
      { userId: req.user._id },
      { sharedWith: req.user._id }
    ]

  });

  const updatedProjects = await Promise.all(

    projects.map(async (project) => {

      const tasks = await Task.find({
        projectId: project._id
      });

      const total = tasks.length;

      const completed = tasks.filter(
        t => t.completed
      ).length;

      const progress =
        total === 0
          ? 0
          : Math.round((completed / total) * 100);

      return {

        id: project._id,

        name: project.title,

        description: project.description,

        progress

      };

    })

  );

  res.render("projects", {
    projects: updatedProjects
  });

});

// NEW PROJECT PAGE
app.get("/projects/new", requireAuth, async (req, res) => {

  const teams = await Team.find({
    members: req.user._id
  });

  res.render("new-project", {

    error: null,

    teams

  });

});

// CREATE PROJECT
app.post("/projects", requireAuth, async (req, res) => {

  const title = req.body.title || req.body.name;

  let sharedUsers = [];

  if (req.body.teamId) {

    const team = await Team.findById(
      req.body.teamId
    );

    if (team) {
      sharedUsers = team.members;
    }

  }

  await Project.create({

    title,

    description: req.body.description,

    userId: req.user._id,

    teamId: req.body.teamId || null,

    sharedWith: sharedUsers

  });

  res.redirect("/projects");

});

// PROJECT DETAIL
app.get("/projects/:id", requireAuth, async (req, res) => {

  const project = await Project.findOne({

    _id: req.params.id,

    $or: [
      { userId: req.user._id },
      { sharedWith: req.user._id }
    ]

  });

  if (!project) {
    return res.send("Project not found");
  }

  const tasks = await Task.find({
    projectId: project._id
  });

  const total = tasks.length;

  const completed = tasks.filter(
    t => t.completed
  ).length;

  const progress =
    total === 0
      ? 0
      : Math.round((completed / total) * 100);
      const snippets = await CodeSnippet.find({
  projectId: project._id
}).populate("userId");

  res.render("project-detail", {

    project: {

      id: project._id,

      name: project.title,

      description: project.description,

      progress

    },

    tasks,

  snippets

  });

});
// =====================================================
// CODE REVIEW
// =====================================================

// SHOW NEW SNIPPET PAGE
app.get("/projects/:id/snippets/new", requireAuth, async (req, res) => {

  const project = await Project.findById(req.params.id);

  if (!project) {
    return res.send("Project not found");
  }

  res.render("new-snippet", { project });

});

// CREATE SNIPPET
app.post("/projects/:id/snippets", requireAuth, async (req, res) => {

  const {
    title,
    language,
    code
  } = req.body;

  await CodeSnippet.create({

    title,
    language,
    code,

    projectId: req.params.id,

    userId: req.user._id

  });

  res.redirect(`/projects/${req.params.id}`);

});

// VIEW SNIPPET DETAIL
app.get("/snippets/:id", requireAuth, async (req, res) => {

  const snippet = await CodeSnippet.findById(req.params.id)
    .populate("userId");

  if (!snippet) {
    return res.send("Snippet not found");
  }

  const comments = await ReviewComment.find({
    snippetId: snippet._id
  }).populate("userId");

  res.render("snippet-detail", {

    snippet,
    comments

  });

});

// ADD REVIEW COMMENT
app.post("/snippets/:id/comment", requireAuth, async (req, res) => {

  await ReviewComment.create({

    comment: req.body.comment,

    snippetId: req.params.id,

    userId: req.user._id

  });

  res.redirect(`/snippets/${req.params.id}`);

});
// =====================================================
// TASKS
// =====================================================

// CREATE TASK
app.post("/projects/:id/tasks", requireAuth, async (req, res) => {

  await Task.create({

    title: req.body.title,

    projectId: req.params.id,

    userId: req.user._id

  });

  res.redirect(`/projects/${req.params.id}`);

});

// TASK PAGE
app.get("/tasks", requireAuth, async (req, res) => {

  const tasks = await Task.find({})
    .populate("projectId");

  const formattedTasks = tasks.map(t => ({

    id: t._id,

    title: t.title,

    completed: t.completed,

    projectTitle:
      t.projectId
        ? t.projectId.title
        : "Unknown"

  }));

  res.render("tasks", {
    tasks: formattedTasks
  });

});

// TOGGLE TASK
app.post("/tasks/:id/toggle", requireAuth, async (req, res) => {

  const task = await Task.findById(req.params.id);

  if (!task) {
    return res.send("Task not found");
  }

  task.completed = !task.completed;

  await task.save();

  res.redirect("back");

});

// =====================================================
// ERROR
// =====================================================

app.use((err, req, res, next) => {

  console.error(err);

  res.status(500).send("Server Error");

});

// =====================================================
// START
// =====================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(
    "Server running on port " + PORT
  );

});