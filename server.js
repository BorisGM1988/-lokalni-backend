const express = require('express');
const compression = require('compression');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const app = express();

// ===== GZIP KOMPRESIJA =====
app.use(compression());

// ===== SENDGRID SETUP =====
async function posaljiEmailNotifikaciju(email, ime, odKoga) {
  try {
    await sgMail.send({
      to: email,
      from: 'lokalniplodovi@gmail.com',
      subject: '📬 Imate novu poruku na LokalniPlodovi',
      html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
        <h2 style="color:#2e7d32;">🌿 LokalniPlodovi</h2>
        <p>Pozdrav <strong>${ime}</strong>,</p>
        <p>Dobili ste novu poruku od korisnika <strong>${odKoga}</strong>.</p>
        <a href="https://lokalniplodovi.rs/moj-profil.html" style="display:inline-block;background:#2e7d32;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Pogledaj poruku</a>
        <p style="color:#999;font-size:12px;margin-top:30px;">LokalniPlodovi • lokalniplodovi.rs</p>
      </div>`
    });
    console.log('✅ Email poslat na:', email);
  } catch (err) {
    console.error('❌ Email greška:', err.message);
  }
}

async function posaljiGrupniEmail(emailovi, naslov, poruka) {
  const rezultati = { uspesno: 0, neuspesno: 0 };
  for (const email of emailovi) {
    try {
      await sgMail.send({
        to: email,
        from: 'lokalniplodovi@gmail.com',
        subject: naslov,
        html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
          <h2 style="color:#2e7d32;">🌿 LokalniPlodovi</h2>
          <div style="background:#f5f5f5;padding:15px;border-radius:8px;">${poruka.replace(/\n/g,'<br>')}</div>
          <a href="https://lokalniplodovi.rs" style="display:inline-block;background:#2e7d32;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px;">Poseti sajt</a>
          <p style="color:#999;font-size:12px;margin-top:30px;">LokalniPlodovi • lokalniplodovi.rs</p>
        </div>`
      });
      rezultati.uspesno++;
    } catch (err) {
      console.error('Greška za:', email, err.message);
      rezultati.neuspesno++;
    }
  }
  return rezultati;
}
// ===== KRAJ SENDGRID SETUP =====

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-password');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '2mb' }));

function normalizeText(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/š/g, 's')
    .replace(/đ/g, 'dj')
    .replace(/č/g, 'c')
    .replace(/ć/g, 'c')
    .replace(/ž/g, 'z');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function uploadSlika(base64) {
  if (!base64) return null;
  if (base64.startsWith('http')) return base64;
  try {
    const result = await cloudinary.uploader.upload(base64, {
      folder: 'lokalni-plodovi',
      transformation: [
        { quality: 'auto:good' },
        { width: 800, crop: 'limit' }
      ]
    });
    return result.secure_url;
  } catch (err) {
    console.error('Cloudinary upload greška:', err);
    return base64;
  }
}

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, ime TEXT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, telefon TEXT, lokacija TEXT, nise TEXT, opis TEXT, slika TEXT, cover_slika TEXT, tip TEXT DEFAULT 'prodavac', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_slika TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tip TEXT DEFAULT 'prodavac'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS aktivan BOOLEAN DEFAULT true`);
    await pool.query(`CREATE TABLE IF NOT EXISTS proizvodi (id SERIAL PRIMARY KEY, "userId" INTEGER, naziv TEXT, opis TEXT, cena NUMERIC, kolicina NUMERIC, "glavnaNisa" TEXT, podnisa TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`ALTER TABLE proizvodi ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS objave (id SERIAL PRIMARY KEY, "userId" INTEGER NOT NULL, tekst TEXT NOT NULL, slika TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`ALTER TABLE objave ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`ALTER TABLE objave ADD COLUMN IF NOT EXISTS video TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS poruke (id SERIAL PRIMARY KEY, od_user_id INTEGER NOT NULL, ka_user_id INTEGER NOT NULL, tekst TEXT NOT NULL, procitano BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ocene (id SERIAL PRIMARY KEY, od_user_id INTEGER NOT NULL, za_user_id INTEGER NOT NULL, ocena INTEGER NOT NULL CHECK (ocena >= 1 AND ocena <= 5), komentar TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(od_user_id, za_user_id))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS lista_zelja (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, proizvod_id INTEGER NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, proizvod_id))`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lat NUMERIC`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lng NUMERIC`);

    // ===== BLOG TABELA =====
    await pool.query(`CREATE TABLE IF NOT EXISTS blogovi (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER NOT NULL,
      naslov TEXT NOT NULL,
      tekst TEXT NOT NULL,
      slika TEXT,
      video TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`ALTER TABLE blogovi ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`ALTER TABLE blogovi ADD COLUMN IF NOT EXISTS video TEXT`);
    // =======================

    console.log('Baza inicijalizovana uspešno!');
  } catch (err) {
    console.error('Greška pri inicijalizaciji baze:', err.message);
  }
}

initDB();

setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 4 * 60 * 1000);

const JWT_SECRET = process.env.JWT_SECRET || 'promeni-ovo-u-dug-random-string-za-produkciju-2026';

app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// ===== SSR ZA BLOG.HTML =====
const fs = require('fs');
const path = require('path');

app.get('/blog.html', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.sendFile(path.join(__dirname, 'public', 'blog.html'));
  try {
    const result = await pool.query(
      `SELECT b.naslov, b.tekst, b.slika, u.ime as "autorIme" FROM blogovi b JOIN users u ON b."userId" = u.id WHERE b.id = $1`,
      [id]
    );
    if (!result.rows[0]) return res.sendFile(path.join(__dirname, 'public', 'blog.html'));
    const b = result.rows[0];
    const naslov = (b.naslov || 'Blog – LokalniPlodovi').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const opis = (b.tekst || '').substring(0, 160).replace(/\n/g, ' ').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const slika = b.slika || 'https://lokalniplodovi.rs/og-slika.jpg';
    const blogUrl = `https://lokalniplodovi.rs/blog.html?id=${id}`;
    let html = fs.readFileSync(path.join(__dirname, 'public', 'blog.html'), 'utf8');
    html = html
      .replace(/<title id="page-title">.*?<\/title>/, `<title id="page-title">${naslov} – LokalniPlodovi</title>`)
      .replace(/(<meta property="og:title"[^>]*content=")[^"]*(")/,`$1${naslov}$2`)
      .replace(/(<meta property="og:description"[^>]*content=")[^"]*(")/,`$1${opis}$2`)
      .replace(/(<meta property="og:url"[^>]*content=")[^"]*(")/,`$1${blogUrl}$2`)
      .replace(/(<meta property="og:image"[^>]*content=")[^"]*(")/,`$1${slika}$2`)
      .replace(/(<meta name="description"[^>]*content=")[^"]*(")/,`$1${opis}$2`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('SSR greška za blog.html:', err);
    res.sendFile(path.join(__dirname, 'public', 'blog.html'));
  }
});

// ===== OG META TAGOVI ZA FACEBOOK SHARE =====
app.get('/blog-share/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.naslov, b.tekst, b.slika, u.ime as "autorIme" FROM blogovi b JOIN users u ON b."userId" = u.id WHERE b.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).send('Blog nije pronađen');
    const b = result.rows[0];
    const naslov = b.naslov.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const opis = b.tekst.substring(0, 160).replace(/\n/g, ' ').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const slika = b.slika || 'https://lokalniplodovi.rs/og-slika.jpg';
    const url = `https://lokalniplodovi.rs/blog.html?id=${req.params.id}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="sr"><head><meta charset="UTF-8"><meta property="og:title" content="${naslov}"><meta property="og:description" content="${opis}"><meta property="og:image" content="${slika}"><meta property="og:url" content="${url}"><meta property="og:type" content="article"><meta property="og:site_name" content="LokalniPlodovi"><meta property="og:locale" content="sr_RS"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${naslov}"><meta name="twitter:description" content="${opis}"><meta name="twitter:image" content="${slika}"><title>${naslov} – LokalniPlodovi</title></head><body><p>Preusmeravanje na blog post...</p><script>window.location.href='${url}';</script></body></html>`);
  } catch (err) {
    console.error('Blog share greška:', err);
    res.status(500).send('Greška na serveru');
  }
});

// ===== USERNAME RUTE =====
app.get('/p/:username', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id FROM users WHERE username = $1`, [req.params.username]);
    if (!result.rows[0]) return res.status(404).send('Profil nije pronađen');
    res.redirect(`https://lokalniplodovi.rs/moj-profil.html?userId=${result.rows[0].id}`);
  } catch (err) { res.status(500).send('Greška na serveru'); }
});

app.post('/profile/username', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username je obavezan' });
    if (!/^[a-z0-9\-_]+$/.test(username)) return res.status(400).json({ error: 'Username sme da sadrži samo mala slova, brojeve, - i _' });
    if (username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Username mora biti između 3 i 30 karaktera' });
    await pool.query(`UPDATE users SET username = $1 WHERE id = $2`, [username, decoded.userId]);
    res.json({ message: 'Username uspešno postavljen!', link: `https://lokalniplodovi.rs/p/${username}` });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ovaj username već postoji, izaberite drugi' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/profile/username/provjeri/:username', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id FROM users WHERE username = $1`, [req.params.username]);
    res.json({ slobodan: result.rows.length === 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== RANDOM PROIZVODI ZA TRAKU =====
app.get('/random-proizvodi', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.naziv, p.cena, p."glavnaNisa", p.podnisa,
             u.id as "prodavacId", u.ime as "prodavacIme", u.lokacija as "prodavacLokacija"
      FROM proizvodi p
      JOIN users u ON p."userId" = u.id
      WHERE p.naziv IS NOT NULL AND p.cena IS NOT NULL
      ORDER BY RANDOM()
      LIMIT 12
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Greška pri učitavanju random proizvoda:', err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});
// =====================================

app.post('/register', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;
  if (!ime || !email || !lozinka || !telefon || !lokacija) return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);
    const result = await pool.query(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis, tip) VALUES ($1, $2, $3, $4, $5, $6, $7, 'prodavac') RETURNING id`,
      [ime, email, hashedPassword, telefon, lokacija, JSON.stringify(nise || []), opis || null]
    );
    const userId = result.rows[0].id;
    const token = jwt.sign({ userId, email, tip: 'prodavac' }, JWT_SECRET, { expiresIn: '90d' });
    res.status(201).json({ message: 'Registracija uspešna', token, user: { id: userId, ime, email, tip: 'prodavac' } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email već postoji' });
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

app.post('/register-kupac', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija } = req.body;
  if (!ime || !email || !lozinka) return res.status(400).json({ error: 'Ime, email i lozinka su obavezni' });
  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);
    const result = await pool.query(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis, tip) VALUES ($1, $2, $3, $4, $5, '[]', null, 'kupac') RETURNING id`,
      [ime, email, hashedPassword, telefon || null, lokacija || null]
    );
    const userId = result.rows[0].id;
    const token = jwt.sign({ userId, email, tip: 'kupac' }, JWT_SECRET, { expiresIn: '90d' });
    res.status(201).json({ message: 'Registracija kupca uspešna', token, user: { id: userId, ime, email, tip: 'kupac' } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email već postoji' });
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

app.post('/login', async (req, res) => {
  const { email, lozinka } = req.body;
  if (!email || !lozinka) return res.status(400).json({ error: 'Email i lozinka su obavezni' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });
    const isMatch = await bcrypt.compare(lozinka, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });
    const tip = user.tip || 'prodavac';
    const token = jwt.sign({ userId: user.id, email, tip }, JWT_SECRET, { expiresIn: '90d' });
    res.json({ message: 'Prijava uspešna', token, user: { id: user.id, ime: user.ime, email: user.email, telefon: user.telefon, lokacija: user.lokacija, opis: user.opis, nise: user.nise ? JSON.parse(user.nise) : [], tip, username: user.username || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

app.get('/profile', async (req, res) => {
  const { userId } = req.query;
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
  try {
    if (userId) {
      const result = await pool.query(`SELECT id, ime, email, telefon, lokacija, opis, nise, slika, cover_slika, tip, username, aktivan, created_at as "registeredAt" FROM users WHERE id = $1`, [userId]);
      const user = result.rows[0];
      if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });
      return res.json({ ime: user.ime, email: user.email, telefon: user.telefon, lokacija: user.lokacija, opis: user.opis || '', nise: user.nise ? JSON.parse(user.nise) : [], slika: user.slika || '', coverSlika: user.cover_slika || '', tip: user.tip || 'prodavac', username: user.username || null, aktivan: user.aktivan !== false, registeredAt: user.registeredAt });
    }
    if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });
    res.json({ ime: user.ime, email: user.email, telefon: user.telefon, lokacija: user.lokacija, opis: user.opis || '', nise: user.nise ? JSON.parse(user.nise) : [], slika: user.slika || '', coverSlika: user.cover_slika || '', tip: user.tip || 'prodavac', username: user.username || null, aktivan: user.aktivan !== false });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

app.post('/profile/update', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { ime, opis, telefon, lokacija, aktivan, slikaBase64, coverSlikaBase64 } = req.body;
    const polja = []; const vrednosti = []; let i = 1;
    if (ime !== undefined)      { polja.push(`ime = $${i++}`);      vrednosti.push(ime); }
    if (opis !== undefined)     { polja.push(`opis = $${i++}`);     vrednosti.push(opis); }
    if (telefon !== undefined)  { polja.push(`telefon = $${i++}`);  vrednosti.push(telefon); }
    if (lokacija !== undefined) { polja.push(`lokacija = $${i++}`); vrednosti.push(lokacija); }
    if (aktivan !== undefined)  { polja.push(`aktivan = $${i++}`);  vrednosti.push(aktivan); }
    if (slikaBase64 !== undefined) { const slikaUrl = await uploadSlika(slikaBase64); polja.push(`slika = $${i++}`); vrednosti.push(slikaUrl); }
    if (coverSlikaBase64 !== undefined) { const coverUrl = await uploadSlika(coverSlikaBase64); polja.push(`cover_slika = $${i++}`); vrednosti.push(coverUrl); }
    if (polja.length === 0) return res.status(400).json({ error: 'Nema podataka za izmenu' });
    vrednosti.push(decoded.userId);
    await pool.query(`UPDATE users SET ${polja.join(', ')} WHERE id = $${i}`, vrednosti);
    res.json({ message: 'Profil uspešno izmenjen!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri izmeni profila' });
  }
});

app.post('/upload-video', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    jwt.verify(token, JWT_SECRET);
    const { videoBase64 } = req.body;
    if (!videoBase64) return res.status(400).json({ error: 'Nema video fajla' });
    const result = await cloudinary.uploader.upload(videoBase64, { resource_type: 'video', folder: 'lokalni-plodovi', transformation: [{ duration: '30' }, { quality: 'auto:low' }, { width: 720, crop: 'limit' }] });
    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary greška:', err);
    res.status(500).json({ error: 'Greška pri uploadu videa' });
  }
});

app.post('/objavi-novost', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { tekst, slikaBase64, videoUrl } = req.body;
    if (!tekst || tekst.trim() === '') return res.status(400).json({ error: 'Tekst objave ne može biti prazan' });
    const slikaUrl = await uploadSlika(slikaBase64);
    const result = await pool.query(`INSERT INTO objave ("userId", tekst, slika, video) VALUES ($1, $2, $3, $4) RETURNING id`, [decoded.userId, tekst.trim(), slikaUrl || null, videoUrl || null]);
    res.json({ message: 'Objava uspešno dodata!', objavaId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

app.get('/moje-objave', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT id, tekst, slika, video, created_at FROM objave WHERE "userId" = $1 ORDER BY created_at DESC`, [decoded.userId]);
    res.json(result.rows);
  } catch (err) { res.status(401).json({ error: 'Nevažeći token' }); }
});

app.delete('/objava/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const check = await pool.query('SELECT "userId" FROM objave WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Objava nije pronađena' });
    if (check.rows[0].userId !== decoded.userId) return res.status(403).json({ error: 'Nemate dozvolu' });
    await pool.query('DELETE FROM objave WHERE id = $1', [req.params.id]);
    res.json({ message: 'Objava uspešno obrisana' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri brisanju' });
  }
});

app.get('/svi-prodavci', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, ime, opis, slika, lokacija, nise, username FROM users WHERE (tip = 'prodavac' OR tip IS NULL) AND aktivan IS NOT FALSE ORDER BY ime ASC`);
    const prodavci = result.rows.map(row => {
      let niseParsed = [];
      try { niseParsed = row.nise ? JSON.parse(row.nise) : []; } catch (e) {}
      return { id: row.id, ime: row.ime || 'Bez imena', opis: row.opis || 'Porodična proizvodnja svežih domaćih proizvoda.', slika: row.slika || '', lokacija: row.lokacija || 'Lokacija nije navedena', nise: niseParsed, username: row.username || null };
    });
    res.json(prodavci);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška u bazi: ' + err.message });
  }
});

// ===== PRETRAGA (proizvodi + prodavci) =====
app.get('/pretraga', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ proizvodi: [], prodavci: [] });
  try {
    const proizvodiResult = await pool.query(
      `SELECT p.*, u.ime as "prodavacIme", u.lokacija as "prodavacLokacija"
       FROM proizvodi p JOIN users u ON p."userId" = u.id
       WHERE p.naziv ILIKE $1 AND u.aktivan IS NOT FALSE
       ORDER BY p.created_at DESC LIMIT 30`,
      [`%${q}%`]
    );
    const prodavciResult = await pool.query(
      `SELECT id, ime, opis, slika, lokacija, nise, username
       FROM users
       WHERE (tip = 'prodavac' OR tip IS NULL) AND aktivan IS NOT FALSE
         AND (ime ILIKE $1 OR lokacija ILIKE $1)
       ORDER BY ime ASC LIMIT 30`,
      [`%${q}%`]
    );
    const prodavci = prodavciResult.rows.map(row => {
      let niseParsed = [];
      try { niseParsed = row.nise ? JSON.parse(row.nise) : []; } catch (e) {}
      return { id: row.id, ime: row.ime || 'Bez imena', opis: row.opis || '', slika: row.slika || '', lokacija: row.lokacija || '', nise: niseParsed, username: row.username || null };
    });
    res.json({ proizvodi: proizvodiResult.rows, prodavci });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri pretrazi' });
  }
});

app.post('/dodaj-proizvod', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { naziv, cena, kolicina, glavnaNisa, podnisa, opis, slikaBase64 } = req.body;
    if (!naziv || !cena || !kolicina || !glavnaNisa) return res.status(400).json({ error: 'Obavezna polja nisu popunjena' });
    const slikaUrl = await uploadSlika(slikaBase64);
    const result = await pool.query(`INSERT INTO proizvodi ("userId", naziv, opis, cena, kolicina, "glavnaNisa", podnisa, slika) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [decoded.userId, naziv, opis || null, cena, kolicina, glavnaNisa, podnisa || null, slikaUrl || null]);
    res.status(201).json({ message: 'Proizvod uspešno izložen na pijac!', proizvodId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri dodavanju proizvoda' });
  }
});

app.get('/proizvodi', async (req, res) => {
  const { glavnaNisa, podnisa, userId } = req.query;
  try {
    let sql = `SELECT p.*, u.ime as "prodavacIme", u.lokacija as "prodavacLokacija" FROM proizvodi p JOIN users u ON p."userId" = u.id WHERE 1=1`;
    const params = []; let i = 1;
    if (glavnaNisa) { sql += ` AND p."glavnaNisa" = $${i++}`; params.push(glavnaNisa); }
    if (podnisa)    { sql += ` AND LOWER(p.podnisa) = LOWER($${i++})`; params.push(podnisa); }
    if (userId)     { sql += ` AND p."userId" = $${i++}`; params.push(userId); }
    else            { sql += ` AND u.aktivan IS NOT FALSE`; }
    sql += ` ORDER BY p.created_at DESC`;
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri učitavanju proizvoda' });
  }
});

app.put('/proizvod/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { naziv, cena, kolicina, opis } = req.body;
    if (!naziv || !cena || !kolicina) return res.status(400).json({ error: 'Obavezna polja nisu popunjena' });
    const check = await pool.query('SELECT "userId" FROM proizvodi WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Proizvod nije pronađen' });
    if (check.rows[0].userId !== decoded.userId) return res.status(403).json({ error: 'Nemate dozvolu' });
    await pool.query(`UPDATE proizvodi SET naziv=$1, cena=$2, kolicina=$3, opis=$4 WHERE id=$5`, [naziv, cena, kolicina, opis || null, req.params.id]);
    res.json({ message: 'Proizvod uspešno izmenjen!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri izmeni proizvoda' });
  }
});

app.delete('/proizvod/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const check = await pool.query('SELECT "userId" FROM proizvodi WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Proizvod nije pronađen' });
    if (check.rows[0].userId !== decoded.userId) return res.status(403).json({ error: 'Nemate dozvolu' });
    await pool.query('DELETE FROM proizvodi WHERE id = $1', [req.params.id]);
    res.json({ message: 'Proizvod uspešno obrisan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri brisanju' });
  }
});

app.get('/prodavci-mapa', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, ime, opis, slika, lokacija, nise, lat, lng FROM users WHERE (tip = 'prodavac' OR tip IS NULL) AND aktivan IS NOT FALSE ORDER BY ime ASC`);
    const prodavci = [];
    for (const row of result.rows) {
      let niseParsed = [];
      try { niseParsed = row.nise ? JSON.parse(row.nise) : []; } catch (e) {}
      if (row.lat && row.lng) {
        prodavci.push({ id: row.id, ime: row.ime || 'Bez imena', opis: row.opis || 'Domaći proizvodi', slika: row.slika || '', lokacija: row.lokacija || '', nise: niseParsed, lat: parseFloat(row.lat), lng: parseFloat(row.lng) });
        continue;
      }
      if (!row.lokacija) continue;
      try {
        const varijante = [row.lokacija, row.lokacija.split(',')[0].trim(), row.lokacija.split(' ').slice(0, 3).join(' '), row.lokacija.split(' ')[0].trim()];
        let koordinate = null;
        for (const v of varijante) {
          await new Promise(r => setTimeout(r, 1100));
          const geoResponse = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(v)}&format=json&limit=1&countrycodes=rs`, { headers: { 'User-Agent': 'LokalniPlodovi/1.0' } });
          const geoData = await geoResponse.json();
          if (geoData.length > 0) { koordinate = { lat: parseFloat(geoData[0].lat), lng: parseFloat(geoData[0].lon) }; break; }
        }
        if (koordinate) {
          await pool.query(`UPDATE users SET lat = $1, lng = $2 WHERE id = $3`, [koordinate.lat, koordinate.lng, row.id]);
          prodavci.push({ id: row.id, ime: row.ime || 'Bez imena', opis: row.opis || 'Domaći proizvodi', slika: row.slika || '', lokacija: row.lokacija || '', nise: niseParsed, lat: koordinate.lat, lng: koordinate.lng });
        }
      } catch (e) { console.log('Geocoding greška za:', row.lokacija); }
    }
    res.json(prodavci);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška: ' + err.message });
  }
});

function adminAuth(req, res, next) {
  const lozinka = req.headers['x-admin-password'];
  if (lozinka !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Neovlašćen pristup' });
  next();
}

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const korisnici = await pool.query('SELECT COUNT(*) FROM users');
    const proizvodi = await pool.query('SELECT COUNT(*) FROM proizvodi');
    const objave = await pool.query('SELECT COUNT(*) FROM objave');
    const kupci = await pool.query("SELECT COUNT(*) FROM users WHERE tip = 'kupac'");
    const blogovi = await pool.query('SELECT COUNT(*) FROM blogovi');
    res.json({ korisnici: parseInt(korisnici.rows[0].count), proizvodi: parseInt(proizvodi.rows[0].count), objave: parseInt(objave.rows[0].count), kupci: parseInt(kupci.rows[0].count), blogovi: parseInt(blogovi.rows[0].count) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/korisnici', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, ime, email, telefon, lokacija, nise, tip, username, created_at FROM users ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/proizvodi', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT p.*, u.ime as "prodavacIme", u.email as "prodavacEmail" FROM proizvodi p JOIN users u ON p."userId" = u.id ORDER BY p.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/objave', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT o.*, u.ime as "korisnikIme", u.email as "korisnikEmail" FROM objave o JOIN users u ON o."userId" = u.id ORDER BY o.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/ocene', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT o.*, u1.ime as "odIme", u1.email as "odEmail", u2.ime as "zaIme", u2.email as "zaEmail" FROM ocene o JOIN users u1 ON o.od_user_id = u1.id JOIN users u2 ON o.za_user_id = u2.id ORDER BY o.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/ocena/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM ocene WHERE id = $1', [req.params.id]);
    res.json({ message: 'Ocena obrisana' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/objava/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM objave WHERE id = $1', [req.params.id]);
    res.json({ message: 'Objava obrisana' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/inbox-status', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT u.id, u.ime, u.email, u.tip, COUNT(p.id) as ukupno_poruka, COUNT(CASE WHEN p.procitano = FALSE THEN 1 END) as neprocitane FROM users u LEFT JOIN poruke p ON p.ka_user_id = u.id GROUP BY u.id, u.ime, u.email, u.tip HAVING COUNT(p.id) > 0 ORDER BY neprocitane DESC, ukupno_poruka DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/korisnik/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM proizvodi WHERE "userId" = $1', [req.params.id]);
    await pool.query('DELETE FROM objave WHERE "userId" = $1', [req.params.id]);
    await pool.query('DELETE FROM blogovi WHERE "userId" = $1', [req.params.id]);
    await pool.query('DELETE FROM poruke WHERE od_user_id = $1 OR ka_user_id = $1', [req.params.id]);
    await pool.query('DELETE FROM ocene WHERE od_user_id = $1 OR za_user_id = $1', [req.params.id]);
    await pool.query('DELETE FROM lista_zelja WHERE user_id = $1', [req.params.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'Korisnik obrisan' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/proizvod/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM lista_zelja WHERE proizvod_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proizvodi WHERE id = $1', [req.params.id]);
    res.json({ message: 'Proizvod obrisan' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/admin/proizvod/:id', adminAuth, async (req, res) => {
  const { naziv, cena, kolicina, glavnaNisa, podnisa, opis } = req.body;
  if (!naziv || cena === undefined || kolicina === undefined || !glavnaNisa) return res.status(400).json({ error: 'Naziv, cena, količina i niša su obavezni' });
  try {
    const check = await pool.query('SELECT id FROM proizvodi WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Proizvod nije pronađen' });
    const podnisaFinal = (podnisa && String(podnisa).trim()) ? String(podnisa).trim() : glavnaNisa;
    await pool.query(`UPDATE proizvodi SET naziv=$1, cena=$2, kolicina=$3, "glavnaNisa"=$4, podnisa=$5, opis=$6 WHERE id=$7`, [naziv, cena, kolicina, glavnaNisa, podnisaFinal, opis || null, req.params.id]);
    res.json({ message: 'Proizvod uspešno izmenjen!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/set-koordinate/:id', adminAuth, async (req, res) => {
  const { lat, lng } = req.body;
  try {
    await pool.query(`UPDATE users SET lat = $1, lng = $2 WHERE id = $3`, [lat, lng, req.params.id]);
    res.json({ message: 'Koordinate postavljene!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/set-username/:id', adminAuth, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username je obavezan' });
  try {
    await pool.query(`UPDATE users SET username = $1 WHERE id = $2`, [username, req.params.id]);
    res.json({ message: 'Username postavljen!', link: `https://lokalniplodovi.rs/p/${username}` });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username već postoji' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/grupni-email', adminAuth, async (req, res) => {
  const { naslov, poruka, ciljnaGrupa } = req.body;
  if (!naslov || !poruka) return res.status(400).json({ error: 'Naslov i poruka su obavezni' });
  try {
    let sql = 'SELECT email FROM users WHERE 1=1';
    if (ciljnaGrupa === 'prodavci') sql += ` AND tip = 'prodavac'`;
    else if (ciljnaGrupa === 'kupci') sql += ` AND tip = 'kupac'`;
    const result = await pool.query(sql);
    const emailovi = result.rows.map(r => r.email).filter(Boolean);
    if (emailovi.length === 0) return res.status(400).json({ error: 'Nema korisnika za slanje' });
    const rezultati = await posaljiGrupniEmail(emailovi, naslov, poruka);
    res.json({ message: `Email poslat! Uspešno: ${rezultati.uspesno}, Neuspešno: ${rezultati.neuspesno}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN BLOG =====
app.get('/admin/blogovi', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT b.*, u.ime as "autorIme", u.email as "autorEmail" FROM blogovi b JOIN users u ON b."userId" = u.id ORDER BY b.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/admin/blog/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM blogovi WHERE id = $1', [req.params.id]);
    res.json({ message: 'Blog obrisan' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/objave/:userId', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, tekst, slika, video, created_at FROM objave WHERE "userId" = $1 ORDER BY created_at DESC`, [req.params.userId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/poruka', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { ka_user_id, tekst } = req.body;
    if (!tekst || !ka_user_id) return res.status(400).json({ error: 'Nedostaju podaci' });
    if (decoded.userId === parseInt(ka_user_id)) return res.status(400).json({ error: 'Ne možete pisati sebi' });
    const result = await pool.query(`INSERT INTO poruke (od_user_id, ka_user_id, tekst) VALUES ($1, $2, $3) RETURNING id`, [decoded.userId, ka_user_id, tekst.trim()]);
    const primalac = await pool.query('SELECT ime, email FROM users WHERE id = $1', [ka_user_id]);
    const posiljalac = await pool.query('SELECT ime FROM users WHERE id = $1', [decoded.userId]);
    if (primalac.rows[0] && primalac.rows[0].email) {
      posaljiEmailNotifikaciju(primalac.rows[0].email, primalac.rows[0].ime, posiljalac.rows[0]?.ime || 'Korisnik').catch(e => console.error('Email async greška:', e.message));
    }
    res.json({ message: 'Poruka poslata!', id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/inbox', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT p.*, u.ime as "odIme", u.slika as "odSlika" FROM poruke p JOIN users u ON p.od_user_id = u.id WHERE p.ka_user_id = $1 ORDER BY p.created_at DESC`, [decoded.userId]);
    res.json(result.rows);
  } catch (err) { res.status(401).json({ error: 'Nevažeći token' }); }
});

app.get('/inbox/broj', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT COUNT(*) FROM poruke WHERE ka_user_id = $1 AND procitano = FALSE`, [decoded.userId]);
    res.json({ broj: parseInt(result.rows[0].count) });
  } catch (err) { res.status(401).json({ error: 'Nevažeći token' }); }
});

app.get('/konverzacija/:drugUserId', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const mojId = decoded.userId;
    const drugId = parseInt(req.params.drugUserId);
    const result = await pool.query(
      `SELECT p.*, u_od.ime as "odIme", u_od.slika as "odSlika", u_ka.ime as "kaIme" FROM poruke p JOIN users u_od ON p.od_user_id = u_od.id JOIN users u_ka ON p.ka_user_id = u_ka.id WHERE (p.od_user_id = $1 AND p.ka_user_id = $2) OR (p.od_user_id = $2 AND p.ka_user_id = $1) ORDER BY p.created_at ASC`,
      [mojId, drugId]
    );
    await pool.query(`UPDATE poruke SET procitano = TRUE WHERE ka_user_id = $1 AND od_user_id = $2 AND procitano = FALSE`, [mojId, drugId]);
    const drug = await pool.query(`SELECT id, ime, slika FROM users WHERE id = $1`, [drugId]);
    res.json({ poruke: result.rows, drug: drug.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/konverzacije', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const mojId = decoded.userId;
    const result = await pool.query(
      `SELECT DISTINCT ON (drug_id) drug_id, drug_ime, drug_slika, poslednja_poruka, poslednje_vreme, neprocitane FROM (SELECT CASE WHEN p.od_user_id = $1 THEN p.ka_user_id ELSE p.od_user_id END as drug_id, CASE WHEN p.od_user_id = $1 THEN u_ka.ime ELSE u_od.ime END as drug_ime, CASE WHEN p.od_user_id = $1 THEN u_ka.slika ELSE u_od.slika END as drug_slika, p.tekst as poslednja_poruka, p.created_at as poslednje_vreme, (SELECT COUNT(*) FROM poruke p2 WHERE p2.od_user_id = CASE WHEN p.od_user_id = $1 THEN p.ka_user_id ELSE p.od_user_id END AND p2.ka_user_id = $1 AND p2.procitano = FALSE) as neprocitane FROM poruke p JOIN users u_od ON p.od_user_id = u_od.id JOIN users u_ka ON p.ka_user_id = u_ka.id WHERE p.od_user_id = $1 OR p.ka_user_id = $1 ORDER BY p.created_at DESC) sub ORDER BY drug_id, poslednje_vreme DESC`,
      [mojId]
    );
    const sortirano = result.rows.sort((a, b) => new Date(b.poslednje_vreme) - new Date(a.poslednje_vreme));
    res.json(sortirano);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/poruka/:id/procitano', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await pool.query(`UPDATE poruke SET procitano = TRUE WHERE id = $1 AND ka_user_id = $2`, [req.params.id, decoded.userId]);
    res.json({ message: 'Označeno kao pročitano' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/poruka/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await pool.query(`DELETE FROM poruke WHERE id = $1 AND (ka_user_id = $2 OR od_user_id = $2)`, [req.params.id, decoded.userId]);
    res.json({ message: 'Poruka obrisana' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/ocena', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { za_user_id, ocena, komentar } = req.body;
    if (!za_user_id || !ocena) return res.status(400).json({ error: 'Nedostaju podaci' });
    if (ocena < 1 || ocena > 5) return res.status(400).json({ error: 'Ocena mora biti između 1 i 5' });
    if (decoded.userId === parseInt(za_user_id)) return res.status(400).json({ error: 'Ne možete oceniti sebe' });
    const userCheck = await pool.query('SELECT created_at FROM users WHERE id = $1', [decoded.userId]);
    if (!userCheck.rows[0]) return res.status(404).json({ error: 'Korisnik nije pronađen' });
    const razlikaDana = (new Date() - new Date(userCheck.rows[0].created_at)) / (1000 * 60 * 60 * 24);
    if (razlikaDana < 7) return res.status(403).json({ error: 'Vaš nalog mora biti star najmanje 7 dana da biste mogli da ocenjujete.' });
    const porukaCheck = await pool.query('SELECT id FROM poruke WHERE od_user_id = $1 AND ka_user_id = $2 LIMIT 1', [decoded.userId, za_user_id]);
    if (porukaCheck.rows.length === 0) return res.status(403).json({ error: 'Možete oceniti samo prodavce sa kojima ste stupili u kontakt putem poruke.' });
    await pool.query(`INSERT INTO ocene (od_user_id, za_user_id, ocena, komentar) VALUES ($1, $2, $3, $4) ON CONFLICT (od_user_id, za_user_id) DO UPDATE SET ocena = $3, komentar = $4, created_at = CURRENT_TIMESTAMP`, [decoded.userId, za_user_id, ocena, komentar || null]);
    res.json({ message: 'Ocena uspešno dodata!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/ocene/:userId', async (req, res) => {
  try {
    const result = await pool.query(`SELECT o.*, u.ime as "odIme", u.slika as "odSlika" FROM ocene o JOIN users u ON o.od_user_id = u.id WHERE o.za_user_id = $1 ORDER BY o.created_at DESC`, [req.params.userId]);
    const prosek = result.rows.length > 0 ? (result.rows.reduce((sum, r) => sum + r.ocena, 0) / result.rows.length).toFixed(1) : null;
    res.json({ ocene: result.rows, prosek, ukupno: result.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/moja-ocena/:za_user_id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT * FROM ocene WHERE od_user_id = $1 AND za_user_id = $2`, [decoded.userId, req.params.za_user_id]);
    res.json(result.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/lista-zelja', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { proizvod_id } = req.body;
    if (!proizvod_id) return res.status(400).json({ error: 'Nedostaje proizvod_id' });
    await pool.query(`INSERT INTO lista_zelja (user_id, proizvod_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [decoded.userId, proizvod_id]);
    res.json({ message: 'Dodato u listu želja!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/lista-zelja/:proizvod_id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await pool.query(`DELETE FROM lista_zelja WHERE user_id = $1 AND proizvod_id = $2`, [decoded.userId, req.params.proizvod_id]);
    res.json({ message: 'Uklonjeno iz liste želja' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/lista-zelja', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT p.*, u.ime as "prodavacIme", lz.created_at as "dodato" FROM lista_zelja lz JOIN proizvodi p ON lz.proizvod_id = p.id JOIN users u ON p."userId" = u.id WHERE lz.user_id = $1 ORDER BY lz.created_at DESC`, [decoded.userId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/lista-zelja/provjeri/:proizvod_id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.json({ uListi: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`SELECT id FROM lista_zelja WHERE user_id = $1 AND proizvod_id = $2`, [decoded.userId, req.params.proizvod_id]);
    res.json({ uListi: result.rows.length > 0 });
  } catch (err) { res.json({ uListi: false }); }
});

// ===== BLOG RUTE =====
app.post('/blog', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { naslov, tekst, slikaBase64, videoUrl } = req.body;
    if (!naslov || !naslov.trim()) return res.status(400).json({ error: 'Naslov je obavezan' });
    if (!tekst || !tekst.trim()) return res.status(400).json({ error: 'Tekst bloga je obavezan' });
    const slikaUrl = await uploadSlika(slikaBase64);
    const result = await pool.query(`INSERT INTO blogovi ("userId", naslov, tekst, slika, video) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [decoded.userId, naslov.trim(), tekst.trim(), slikaUrl || null, videoUrl || null]);
    res.json({ message: 'Blog uspešno objavljen!', blogId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

app.get('/blogovi', async (req, res) => {
  try {
    const { userId, limit, offset } = req.query;
    let sql = `SELECT b.*, u.ime as "autorIme", u.slika as "autorSlika", u.lokacija as "autorLokacija" FROM blogovi b JOIN users u ON b."userId" = u.id WHERE 1=1`;
    const params = []; let i = 1;
    if (userId) { sql += ` AND b."userId" = $${i++}`; params.push(userId); }
    sql += ` ORDER BY b.created_at DESC`;
    if (limit) { sql += ` LIMIT $${i++}`; params.push(parseInt(limit)); }
    if (offset) { sql += ` OFFSET $${i++}`; params.push(parseInt(offset)); }
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri učitavanju blogova' });
  }
});

app.get('/blog/:id', async (req, res) => {
  try {
    const result = await pool.query(`SELECT b.*, u.ime as "autorIme", u.slika as "autorSlika", u.lokacija as "autorLokacija", u.username as "autorUsername", u.id as "autorId" FROM blogovi b JOIN users u ON b."userId" = u.id WHERE b.id = $1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Blog nije pronađen' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Greška na serveru' }); }
});

app.delete('/blog/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const check = await pool.query('SELECT "userId" FROM blogovi WHERE id = $1', [req.params.id]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Blog nije pronađen' });
    if (check.rows[0].userId !== decoded.userId) return res.status(403).json({ error: 'Nemate dozvolu' });
    await pool.query('DELETE FROM blogovi WHERE id = $1', [req.params.id]);
    res.json({ message: 'Blog uspešno obrisan' });
  } catch (err) { res.status(500).json({ error: 'Greška pri brisanju' }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
