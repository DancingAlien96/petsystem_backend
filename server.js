const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

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
  ADMIN_USER: ADMIN_USER_ENV,
  ADMIN_PASS: ADMIN_PASS_ENV,
  MONGODB_URI,
} = process.env;

const ADMIN_USER = ADMIN_USER_ENV || 'cristoferperez';
const ADMIN_PASS = ADMIN_PASS_ENV || '65Cr1srt0f3r';

if (!RECAPTCHA_SECRET_KEY || !SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !MONGODB_URI) {
  console.error('Faltan variables de entorno obligatorias. Revisa tu .env.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log('Conectado a MongoDB');
    await ensureAdminUser();
  })
  .catch(error => {
    console.error('Error conectando a MongoDB:', error.message);
    process.exit(1);
  });

const Owner = require('./models/Owner');
const Pet = require('./models/Pet');
const Page = require('./models/Page');
const Alert = require('./models/Alert');
const AdminUser = require('./models/AdminUser');

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

function generateSlug(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let i = 0; i < length; i += 1) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

async function createUniqueSlug() {
  let slug = generateSlug();
  let exists = await Page.findOne({ slug });
  while (exists) {
    slug = generateSlug();
    exists = await Page.findOne({ slug });
  }
  return slug;
}

async function ensureAdminUser() {
  const passwordHash = await bcrypt.hash(ADMIN_PASS, 10);
  const existingAdmin = await AdminUser.findOne({ username: ADMIN_USER });
  if (existingAdmin) {
    const passwordMatches = await bcrypt.compare(ADMIN_PASS, existingAdmin.passwordHash);
    if (!passwordMatches) {
      existingAdmin.passwordHash = passwordHash;
      await existingAdmin.save();
      console.log(`Contraseña del admin ${ADMIN_USER} sincronizada en MongoDB.`);
    }
    return;
  }

  await AdminUser.create({ username: ADMIN_USER, passwordHash });
  console.log(`Admin por defecto creado en Mongo: ${ADMIN_USER}`);
}

async function authenticateAdmin(user, pass) {
  const admin = await AdminUser.findOne({ username: user });
  if (!admin) {
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      const passwordHash = await bcrypt.hash(ADMIN_PASS, 10);
      await AdminUser.create({ username: ADMIN_USER, passwordHash });
      console.log(`Admin creado en MongoDB durante el primer login: ${ADMIN_USER}`);
      return true;
    }
    return false;
  }

  return bcrypt.compare(pass, admin.passwordHash);
}

async function sendAlertEmail(data) {
  const mailOptions = buildAlertEmail(data);
  return transporter.sendMail(mailOptions);
}

app.get('/', (req, res) => {
  res.json({ message: 'PetSystem Backend funcionando' });
});

app.post('/api/alerts/auto/:slug?', async (req, res) => {
  try {
    const { reporterPhone, reporterName, location } = req.body;
    const { slug } = req.params;

    let toEmail = CONTACT_TO_EMAIL;
    let ownerName = 'Anónimo';
    let subject = 'Alerta automática de ubicación de mascota extraviada';

    if (slug) {
      const page = await Page.findOne({ slug }).populate('owner pet');
      if (!page) {
        return res.status(404).json({ error: 'Ruta no encontrada' });
      }
      toEmail = page.owner.email;
      ownerName = page.owner.name || ownerName;
      subject = `Alerta automática para ${page.pet.name}`;
    }

    await sendAlertEmail({
      toEmail,
      subject,
      location: location || undefined,
      reporterPhone: reporterPhone || 'No proporcionado',
      reporterName: reporterName || 'Anónimo',
    });

    return res.json({
      success: true,
      message: 'Correo enviado automáticamente al dueño',
      ownerEmail: toEmail,
    });
  } catch (error) {
    console.error('Error en /api/alerts/auto:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/alerts/:slug?', async (req, res) => {
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

    const { slug } = req.params;
    let toEmail = CONTACT_TO_EMAIL;
    let subject = 'Mensaje de alerta de mascota extraviada';

    if (slug) {
      const page = await Page.findOne({ slug }).populate('owner pet');
      if (!page) {
        return res.status(404).json({ error: 'Ruta no encontrada' });
      }
      toEmail = page.owner.email;
      subject = `Mensaje de ${page.pet.name}`;
    }

    await sendAlertEmail({
      toEmail,
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

app.get('/api/pages/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = await Page.findOne({ slug }).populate('owner pet');
    if (!page) {
      return res.status(404).json({ error: 'Ruta no encontrada' });
    }

    return res.json({
      slug: page.slug,
      ownerName: page.owner.name,
      ownerEmail: page.owner.email,
      ownerPhone: page.owner.phone,
      petName: page.pet.name,
      petType: page.pet.type,
      petBreed: page.pet.breed,
      label: page.label,
    });
  } catch (error) {
    console.error('Error en /api/pages/:slug:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/admin/pages', async (req, res) => {
  try {
    const { adminUser, adminPass, ownerName, ownerEmail, ownerPhone, petName, petType, petBreed } = req.body;

    if (!await authenticateAdmin(adminUser, adminPass)) {
      return res.status(401).json({ error: 'Credenciales de administrador inválidas' });
    }

    if (!ownerName || !ownerEmail || !petName) {
      return res.status(400).json({ error: 'Faltan datos requeridos: ownerName, ownerEmail, petName' });
    }

    const emailLower = ownerEmail.trim().toLowerCase();
    let owner = await Owner.findOne({ email: emailLower });
    if (!owner) {
      owner = await Owner.create({
        name: ownerName,
        email: emailLower,
        phone: ownerPhone,
      });
    }

    const slug = await createUniqueSlug();
    const pet = await Pet.create({
      name: petName,
      type: petType,
      breed: petBreed,
      owner: owner._id,
    });

    owner.pets = owner.pets.concat(pet._id);
    await owner.save();

    await Page.create({
      slug,
      owner: owner._id,
      pet: pet._id,
      label: `Medalla de ${petName}`,
    });

    return res.json({
      success: true,
      slug,
    });
  } catch (error) {
    console.error('Error en /api/admin/pages:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/admin/auth', async (req, res) => {
  try {
    const { adminUser, adminPass } = req.body;
    if (!await authenticateAdmin(adminUser, adminPass)) {
      return res.status(401).json({ error: 'Credenciales de administrador inválidas' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error en /api/admin/auth:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/admin/pages', async (req, res) => {
  try {
    const adminUser = req.headers['x-admin-user'];
    const adminPass = req.headers['x-admin-pass'];

    if (!await authenticateAdmin(adminUser, adminPass)) {
      return res.status(401).json({ error: 'Credenciales de administrador inválidas' });
    }

    const pages = await Page.find().populate('owner pet');
    return res.json(
      pages.map((page) => ({
        slug: page.slug,
        ownerName: page.owner.name,
        ownerEmail: page.owner.email,
        ownerPhone: page.owner.phone,
        petName: page.pet.name,
        petType: page.pet.type,
        petBreed: page.pet.breed,
        label: page.label,
      }))
    );
  } catch (error) {
    console.error('Error en /api/admin/pages GET:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
