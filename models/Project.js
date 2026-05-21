const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema({

  title: {
    type: String,
    required: true
  },

  description: {
    type: String
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Team",
    default: null
  },

  sharedWith: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ]

});

module.exports = mongoose.model(
  "Project",
  ProjectSchema
);