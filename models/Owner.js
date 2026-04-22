const mongoose = require('mongoose');

const ownerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  pets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Pet' }],
}, { timestamps: true });

module.exports = mongoose.model('Owner', ownerSchema);
