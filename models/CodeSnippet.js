const mongoose = require("mongoose");

const CodeSnippetSchema = new mongoose.Schema({

  title: {
    type: String,
    required: true
  },

  language: {
    type: String,
    required: true
  },

  code: {
    type: String,
    required: true
  },

  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Project",
    required: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  }

}, { timestamps: true });

module.exports = mongoose.model(
  "CodeSnippet",
  CodeSnippetSchema
);