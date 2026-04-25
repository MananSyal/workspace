const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,

    // ✅ ADD THIS
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }

    // ❌ REMOVE progress (not needed anymore)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", ProjectSchema);