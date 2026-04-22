const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  pet: { type: mongoose.Schema.Types.ObjectId, ref: 'Pet', required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
  reporterName: { type: String },
  reporterPhone: { type: String },
  location: {
    lat: { type: Number },
    lng: { type: Number },
  },
  message: { type: String },
  status: { type: String, enum: ['new', 'contacted', 'resolved'], default: 'new' },
}, { timestamps: true });

module.exports = mongoose.model('Alert', alertSchema);
