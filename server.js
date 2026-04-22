const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

dotenv.config();

const {
  PORT = 3000,
  ALLOWED_ORIGIN = 'http://localhost:3000',
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  CONTACT_TO_EMAIL,
  MONGODB_URI,
} = process.env;

if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !MONGODB_URI) {
  console.error('Faltan variables de entorno obligatorias. Revisa tu .env.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Conectado a MongoDB'))
  .catch(error => {
    console.error('Error conectando a MongoDB:', error.message);
    process.exit(1);
  });

const Owner = require('./models/Owner');
const Pet = require('./models/Pet');
const Alert = require('./models/Alert');

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: SMTP_SECURE === 'true',
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

const app = express();
app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN }));

function buildAlertEmail({ owner, pet, alert, reporterPhone, reporterName }) {
  const locationText = alert.location
    ? `https://www.google.com/maps/search/?api=1&query=${alert.location.lat},${alert.location.lng}`
    : 'Ubicación no disponible';

  return {
    from: SMTP_USER,
    to: owner.email || CONTACT_TO_EMAIL,
    subject: `Alerta de extravío: ${pet.name}`,
    text: `Hola ${owner.name || 'dueño'},

Se ha generado una nueva alerta de extravío para la mascota: ${pet.name}.

Detalles:
- Mascota: ${pet.name}
- Tipo: ${pet.type || 'No especificado'}
- Ubicación: ${locationText}
- Reportado por: ${reporterName || 'Anónimo'}
- Teléfono del reportero: ${reporterPhone || 'No proporcionado'}
- Fecha: ${alert.createdAt.toISOString()}

Por favor, revisa el sistema para más información y coordina la recuperación.
`,
    html: `
      <p>Hola ${owner.name || 'dueño'},</p>
      <p>Se ha generado una nueva alerta de extravío para la mascota <strong>${pet.name}</strong>.</p>
      <ul>
        <li><strong>Tipo:</strong> ${pet.type || 'No especificado'}</li>
        <li><strong>Ubicación:</strong> ${locationText}</li>
        <li><strong>Reportado por:</strong> ${reporterName || 'Anónimo'}</li>
        <li><strong>Teléfono del reportero:</strong> ${reporterPhone || 'No proporcionado'}</li>
        <li><strong>Fecha:</strong> ${alert.createdAt.toISOString()}</li>
      </ul>
      <p>Gracias,</p>
      <p>Equipo de PetSystem</p>
    `,
  };
}

async function sendAlertEmail(data) {
  const mailOptions = buildAlertEmail(data);
  return transporter.sendMail(mailOptions);
}

app.get('/', (req, res) => {
  res.json({ message: 'PetSystem Backend funcionando' });
});

app.post('/api/alerts/auto', async (req, res) => {
  try {
    const { petId, reporterPhone, reporterName, location } = req.body;

    if (!petId) {
      return res.status(400).json({ error: 'petId es obligatorio' });
    }

    const pet = await Pet.findById(petId).populate('owner');
    if (!pet) {
      return res.status(404).json({ error: 'Mascota no encontrada' });
    }

    const owner = pet.owner;
    if (!owner) {
      return res.status(404).json({ error: 'Dueño no encontrado para esta mascota' });
    }

    const alert = await Alert.create({
      pet: pet._id,
      owner: owner._id,
      reporterPhone: reporterPhone || 'No proporcionado',
      reporterName: reporterName || 'Anónimo',
      location: location || undefined,
      status: 'new',
    });

    await sendAlertEmail({ owner, pet, alert, reporterPhone, reporterName });

    return res.json({
      success: true,
      message: 'Correo enviado automáticamente al dueño',
      alertId: alert._id,
      ownerEmail: owner.email,
      petName: pet.name,
    });
  } catch (error) {
    console.error('Error en /api/alerts/auto:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/alerts', async (req, res) => {
  try {
    const { petId, reporterPhone, reporterName, location, message } = req.body;

    if (!petId) {
      return res.status(400).json({ error: 'petId es obligatorio' });
    }

    const pet = await Pet.findById(petId).populate('owner');
    if (!pet) {
      return res.status(404).json({ error: 'Mascota no encontrada' });
    }

    const owner = pet.owner;
    if (!owner) {
      return res.status(404).json({ error: 'Dueño no encontrado para esta mascota' });
    }

    const alert = await Alert.create({
      pet: pet._id,
      owner: owner._id,
      reporterPhone: reporterPhone || 'No proporcionado',
      reporterName: reporterName || 'Anónimo',
      location: location || undefined,
      message: message || '',
      status: 'new',
    });

    return res.json({
      success: true,
      message: 'Alerta creada correctamente',
      alertId: alert._id,
    });
  } catch (error) {
    console.error('Error en /api/alerts:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
