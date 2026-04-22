const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

dotenv.config();

const {
  PORT = 3000,
  ALLOWED_ORIGIN = 'http://localhost:3000',
  RECAPTCHA_SECRET_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  CONTACT_TO_EMAIL,
  MONGODB_URI,
} = process.env;

if (!RECAPTCHA_SECRET_KEY || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !MONGODB_URI) {
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

const allowedOrigins = ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(",").map((origin) => origin.trim()) : [];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
  })
);

function buildAlertEmail({
  toEmail,
  subject,
  location,
  reporterPhone,
  reporterName,
  message,
}) {
  const locationText = location
    ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`
    : 'Ubicación no disponible';

  const text = message
    ? `Hola,

Has recibido un nuevo mensaje relacionado con una mascota extraviada.

Detalles:
- Ubicación: ${locationText}
- Reportado por: ${reporterName || 'Anónimo'}
- Teléfono del reportero: ${reporterPhone || 'No proporcionado'}
- Mensaje: ${message}

Por favor, responde al reportero para coordinar la recuperación.`
    : `Hola,

Se ha abierto la página de ubicación de la mascota perdida.

Detalles:
- Ubicación: ${locationText}
- Reportado por: ${reporterName || 'Anónimo'}
- Teléfono del reportero: ${reporterPhone || 'No proporcionado'}

Por favor, revisa el asunto y coordina la búsqueda.`;

  return {
    from: SMTP_USER,
    to: toEmail,
    subject,
    text,
    html: `
      <p>Hola,</p>
      <p>${message ? 'Has recibido un nuevo mensaje relacionado con una mascota extraviada.' : 'Se ha abierto la página de ubicación de la mascota perdida.'}</p>
      <ul>
        <li><strong>Ubicación:</strong> <a href="${locationText}">${locationText}</a></li>
        <li><strong>Reportado por:</strong> ${reporterName || 'Anónimo'}</li>
        <li><strong>Teléfono del reportero:</strong> ${reporterPhone || 'No proporcionado'}</li>
        ${message ? `<li><strong>Mensaje:</strong> ${message}</li>` : ''}
      </ul>
      <p>Gracias,</p>
      <p>Equipo de PetSystem</p>
    `,
  };
}

async function verifyRecaptcha(token, remoteIp) {
  if (!token) {
    return false;
  }

  const params = new URLSearchParams({
    secret: RECAPTCHA_SECRET_KEY,
    response: token,
  });

  if (remoteIp) {
    params.append('remoteip', remoteIp);
  }

  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    body: params,
  });

  const result = await response.json();
  return result.success === true;
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
    const { reporterPhone, reporterName, location } = req.body;

    const subject = 'Alerta automática de ubicación de mascota extraviada';
    await sendAlertEmail({
      toEmail: CONTACT_TO_EMAIL,
      subject,
      location: location || undefined,
      reporterPhone: reporterPhone || 'No proporcionado',
      reporterName: reporterName || 'Anónimo',
    });

    return res.json({
      success: true,
      message: 'Correo enviado automáticamente al dueño',
      ownerEmail: CONTACT_TO_EMAIL,
    });
  } catch (error) {
    console.error('Error en /api/alerts/auto:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/alerts', async (req, res) => {
  try {
    const { reporterPhone, reporterName, location, message, recaptchaToken } = req.body;

    if (!recaptchaToken) {
      return res.status(400).json({ error: 'Token de reCAPTCHA es obligatorio' });
    }

    const recaptchaValid = await verifyRecaptcha(recaptchaToken, req.ip);
    if (!recaptchaValid) {
      return res.status(400).json({ error: 'Validación de reCAPTCHA fallida' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'El mensaje es obligatorio' });
    }

    const subject = 'Mensaje de alerta de mascota extraviada';
    await sendAlertEmail({
      toEmail: CONTACT_TO_EMAIL,
      subject,
      location: location || undefined,
      reporterPhone: reporterPhone || 'No proporcionado',
      reporterName: reporterName || 'Anónimo',
      message,
    });

    return res.json({
      success: true,
      message: 'Mensaje enviado correctamente al dueño',
    });
  } catch (error) {
    console.error('Error en /api/alerts:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
