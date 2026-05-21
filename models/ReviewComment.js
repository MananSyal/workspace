const mongoose = require("mongoose");

const ReviewCommentSchema = new mongoose.Schema({

  comment: {
    type: String,
    required: true
  },

  snippetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CodeSnippet",
    required: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  }

}, { timestamps: true });

module.exports = mongoose.model(
  "ReviewComment",
  ReviewCommentSchema
);