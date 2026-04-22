const mongoose = require('mongoose');

const petSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String },
  breed: { type: String },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
  isMissing: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Pet', petSchema);
