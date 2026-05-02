const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;

const app = express();

// CLOUDINARY CONFIG
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// RUČNI CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-password');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));

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

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        ime TEXT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        telefon TEXT,
        lokacija TEXT,
        nise TEXT,
        opis TEXT,
        slika TEXT,
        cover_slika TEXT,
        tip TEXT DEFAULT 'prodavac',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_slika TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tip TEXT DEFAULT 'prodavac'`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS proizvodi (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER,
        naziv TEXT,
        opis TEXT,
        cena NUMERIC,
        kolicina NUMERIC,
        "glavnaNisa" TEXT,
        podnisa TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE proizvodi ADD COLUMN IF NOT EXISTS slika TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS objave (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        tekst TEXT NOT NULL,
        slika TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE objave ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`ALTER TABLE objave ADD COLUMN IF NOT EXISTS video TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS poruke (
        id SERIAL PRIMARY KEY,
        od_user_id INTEGER NOT NULL,
        ka_user_id INTEGER NOT NULL,
        tekst TEXT NOT NULL,
        procitano BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ocene (
        id SERIAL PRIMARY KEY,
        od_user_id INTEGER NOT NULL,
        za_user_id INTEGER NOT NULL,
        ocena INTEGER NOT NULL CHECK (ocena >= 1 AND ocena <= 5),
        komentar TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(od_user_id, za_user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lista_zelja (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        proizvod_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, proizvod_id)
      )
    `);

    console.log('Baza inicijalizovana uspešno!');
  } catch (err) {
    console.error('Greška pri inicijalizaciji baze:', err.message);
  }
}

initDB();

const JWT_SECRET = process.env.JWT_SECRET || 'promeni-ovo-u-dug-random-string-za-produkciju-2026';

app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// REGISTRACIJA PRODAVCA
app.post('/register', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    const result = await pool.query(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis, tip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'prodavac') RETURNING id`,
      [ime, email, hashedPassword, telefon, lokacija, JSON.stringify(nise || []), opis || null]
    );

    const userId = result.rows[0].id;
    const token = jwt.sign({ userId, email, tip: 'prodavac' }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ message: 'Registracija uspešna', token, user: { id: userId, ime, email, tip: 'prodavac' } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email već postoji' });
    }
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// REGISTRACIJA KUPCA
app.post('/register-kupac', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija } = req.body;

  if (!ime || !email || !lozinka) {
    return res.status(400).json({ error: 'Ime, email i lozinka su obavezni' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    const result = await pool.query(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis, tip)
       VALUES ($1, $2, $3, $4, $5, '[]', null, 'kupac') RETURNING id`,
      [ime, email, hashedPassword, telefon || null, lokacija || null]
    );

    const userId = result.rows[0].id;
    const token = jwt.sign({ userId, email, tip: 'kupac' }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ message: 'Registracija kupca uspešna', token, user: { id: userId, ime, email, tip: 'kupac' } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email već postoji' });
    }
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// LOGIN (isti za oba tipa)
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
    const token = jwt.sign({ userId: user.id, email, tip }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      message: 'Prijava uspešna',
      token,
      user: {
        id: user.id,
        ime: user.ime,
        email: user.email,
        telefon: user.telefon,
        lokacija: user.lokacija,
        opis: user.opis,
        nise: user.nise ? JSON.parse(user.nise) : [],
        tip
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// GET PROFILE
app.get('/profile', async (req, res) => {
  const { userId } = req.query;
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  try {
    if (userId) {
      const result = await pool.query(
        `SELECT id, ime, email, telefon, lokacija, opis, nise, slika, cover_slika, tip, created_at as "registeredAt"
         FROM users WHERE id = $1`,
        [userId]
      );
      const user = result.rows[0];
      if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

      return res.json({
        ime: user.ime,
        email: user.email,
        telefon: user.telefon,
        lokacija: user.lokacija,
        opis: user.opis || '',
        nise: user.nise ? JSON.parse(user.nise) : [],
        slika: user.slika || '',
        coverSlika: user.cover_slika || '',
        tip: user.tip || 'prodavac',
        registeredAt: user.registeredAt
      });
    }

    if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

    res.json({
      ime: user.ime,
      email: user.email,
      telefon: user.telefon,
      lokacija: user.lokacija,
      opis: user.opis || '',
      nise: user.nise ? JSON.parse(user.nise) : [],
      slika: user.slika || '',
      coverSlika: user.cover_slika || '',
      tip: user.tip || 'prodavac'
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// UPDATE PROFILA
app.post('/profile/update', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { ime, opis, telefon, lokacija, slikaBase64, coverSlikaBase64 } = req.body;

    const polja = [];
    const vrednosti = [];
    let i = 1;

    if (ime !== undefined)             { polja.push(`ime = $${i++}`);         vrednosti.push(ime); }
    if (opis !== undefined)            { polja.push(`opis = $${i++}`);        vrednosti.push(opis); }
    if (telefon !== undefined)         { polja.push(`telefon = $${i++}`);     vrednosti.push(telefon); }
    if (lokacija !== undefined)        { polja.push(`lokacija = $${i++}`);    vrednosti.push(lokacija); }
    if (slikaBase64 !== undefined)     { polja.push(`slika = $${i++}`);       vrednosti.push(slikaBase64); }
    if (coverSlikaBase64 !== undefined){ polja.push(`cover_slika = $${i++}`); vrednosti.push(coverSlikaBase64); }

    if (polja.length === 0) {
      return res.status(400).json({ error: 'Nema podataka za izmenu' });
    }

    vrednosti.push(decoded.userId);
    await pool.query(`UPDATE users SET ${polja.join(', ')} WHERE id = $${i}`, vrednosti);

    res.json({ message: 'Profil uspešno izmenjen!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri izmeni profila' });
  }
});

// UPLOAD VIDEO NA CLOUDINARY
app.post('/upload-video', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    jwt.verify(token, JWT_SECRET);

    const { videoBase64 } = req.body;
    if (!videoBase64) return res.status(400).json({ error: 'Nema video fajla' });

    const result = await cloudinary.uploader.upload(videoBase64, {
      resource_type: 'video',
      folder: 'lokalni-plodovi',
      transformation: [
        { duration: '60' },
        { quality: 'auto:low' },
        { width: 720, crop: 'limit' }
      ]
    });

    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary greška:', err);
    res.status(500).json({ error: 'Greška pri uploadu videa' });
  }
});

// OBJAVI NOVOST
app.post('/objavi-novost', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { tekst, slikaBase64, videoUrl } = req.body;

    if (!tekst || tekst.trim() === '') return res.status(400).json({ error: 'Tekst objave ne može biti prazan' });

    const result = await pool.query(
      `INSERT INTO objave ("userId", tekst, slika, video) VALUES ($1, $2, $3, $4) RETURNING id`,
      [decoded.userId, tekst.trim(), slikaBase64 || null, videoUrl || null]
    );

    res.json({ message: 'Objava uspešno dodata!', objavaId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// MOJE OBJAVE
app.get('/moje-objave', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT id, tekst, slika, video, created_at FROM objave WHERE "userId" = $1 ORDER BY created_at DESC`,
      [decoded.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// DELETE OBJAVA
app.delete('/objava/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const objavaId = req.params.id;

    const check = await pool.query('SELECT "userId" FROM objave WHERE id = $1', [objavaId]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Objava nije pronađena' });
    if (check.rows[0].userId !== decoded.userId) return res.status(403).json({ error: 'Nemate dozvolu' });

    await pool.query('DELETE FROM objave WHERE id = $1', [objavaId]);
    res.json({ message: 'Objava uspešno obrisana' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri brisanju' });
  }
});

// SVI PRODAVCI
app.get('/svi-prodavci', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, ime, opis, slika, lokacija, nise FROM users WHERE tip = 'prodavac' OR tip IS NULL ORDER BY ime ASC`
    );

    const prodavci = result.rows.map(row => {
      let niseParsed = [];
      try { niseParsed = row.nise ? JSON.parse(row.nise) : []; } catch (e) {}
      return {
        id: row.id,
        ime: row.ime || 'Bez imena',
        opis: row.opis || 'Porodična proizvodnja svežih domaćih proizvoda.',
        slika: row.slika || 'https://via.placeholder.com/400x220?text=' + encodeURIComponent(row.ime || 'Prodavac'),
        lokacija: row.lokacija || 'Lokacija nije navedena',
        nise: niseParsed
      };
    });

    res.json(prodavci);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška u bazi: ' + err.message });
  }
});

// DODAJ PROIZVOD
app.post('/dodaj-proizvod', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { naziv, cena, kolicina, glavnaNisa, podnisa, opis, slikaBase64 } = req.body;

    if (!naziv || !cena || !kolicina || !glavnaNisa) {
      return res.status(400).json({ error: 'Obavezna polja nisu popunjena' });
    }

    const result = await pool.query(
      `INSERT INTO proizvodi ("userId", naziv, opis, cena, kolicina, "glavnaNisa", podnisa, slika)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [decoded.userId, naziv, opis || null, cena, kolicina, glavnaNisa, podnisa || null, slikaBase64 || null]
    );

    res.status(201).json({ message: 'Proizvod uspešno izložen na pijac!', proizvodId: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri dodavanju proizvoda' });
  }
});

// GET PROIZVODI
app.get('/proizvodi', async (req, res) => {
  const { glavnaNisa, podnisa, userId } = req.query;

  try {
    let sql = `
      SELECT p.*, u.ime as "prodavacIme", u.lokacija as "prodavacLokacija"
      FROM proizvodi p
      JOIN users u ON p."userId" = u.id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;

    if (glavnaNisa) { sql += ` AND p."glavnaNisa" = $${i++}`; params.push(glavnaNisa); }
    if (podnisa)    { sql += ` AND LOWER(p.podnisa) = LOWER($${i++})`; params.push(podnisa); }
    if (userId)     { sql += ` AND p."userId" = $${i++}`; params.push(userId); }

    sql += ` ORDER BY p.created_at DESC`;

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri učitavanju proizvoda' });
  }
});

// DELETE PROIZVOD
app.delete('/proizvod/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const proizvodId = req.params.id;

    const check = await pool.query('SELECT "userId" FROM proizvodi WHERE id = $1', [proizvodId]);
    if (!check.rows[0]) return res.status(404).json({ error: 'Proizvod nije pronađen' });
    if (check.rows[0].userId !== decoded.userId) return res.status(403).json({ error: 'Nemate dozvolu' });

    await pool.query('DELETE FROM proizvodi WHERE id = $1', [proizvodId]);
    res.json({ message: 'Proizvod uspešno obrisan' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri brisanju' });
  }
});

// PRODAVCI ZA MAPU
app.get('/prodavci-mapa', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, ime, opis, slika, lokacija, nise FROM users WHERE tip = 'prodavac' OR tip IS NULL ORDER BY ime ASC`
    );

    const prodavci = [];

    for (const row of result.rows) {
      let koordinate = null;

      try {
        const lokacijaVarijante = [
          row.lokacija,
          row.lokacija.split(',')[0].trim(),
          row.lokacija.split(' ').slice(0, 2).join(' '),
          row.lokacija.split(' ').slice(0, 3).join(' '),
          row.lokacija.split(' ')[0].trim()
        ];

        for (const varijanta of lokacijaVarijante) {
          const geoResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(varijanta + ', Serbia')}&format=json&limit=1`,
            { headers: { 'User-Agent': 'LokalniPlodovi/1.0' } }
          );
          const geoData = await geoResponse.json();
          if (geoData.length > 0) {
            koordinate = { lat: parseFloat(geoData[0].lat), lng: parseFloat(geoData[0].lon) };
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        console.log('Geocoding greška za:', row.lokacija);
      }

      if (koordinate) {
        let niseParsed = [];
        try { niseParsed = row.nise ? JSON.parse(row.nise) : []; } catch (e) {}

        prodavci.push({
          id: row.id,
          ime: row.ime || 'Bez imena',
          opis: row.opis || 'Domaći proizvodi',
          slika: row.slika || '',
          lokacija: row.lokacija || '',
          nise: niseParsed,
          lat: koordinate.lat,
          lng: koordinate.lng
        });
      }
    }

    res.json(prodavci);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška: ' + err.message });
  }
});

// ── ADMIN MIDDLEWARE ──
function adminAuth(req, res, next) {
  const lozinka = req.headers['x-admin-password'];
  if (lozinka !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Neovlašćen pristup' });
  }
  next();
}

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const korisnici = await pool.query('SELECT COUNT(*) FROM users');
    const proizvodi = await pool.query('SELECT COUNT(*) FROM proizvodi');
    const objave = await pool.query('SELECT COUNT(*) FROM objave');
    const kupci = await pool.query("SELECT COUNT(*) FROM users WHERE tip = 'kupac'");
    res.json({
      korisnici: parseInt(korisnici.rows[0].count),
      proizvodi: parseInt(proizvodi.rows[0].count),
      objave: parseInt(objave.rows[0].count),
      kupci: parseInt(kupci.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/korisnici', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, ime, email, telefon, lokacija, nise, tip, created_at FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/proizvodi', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.ime as "prodavacIme", u.email as "prodavacEmail"
       FROM proizvodi p JOIN users u ON p."userId" = u.id ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/objave', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.ime as "korisnikIme", u.email as "korisnikEmail"
       FROM objave o JOIN users u ON o."userId" = u.id ORDER BY o.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/korisnik/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM proizvodi WHERE "userId" = $1', [req.params.id]);
    await pool.query('DELETE FROM objave WHERE "userId" = $1', [req.params.id]);
    await pool.query('DELETE FROM poruke WHERE od_user_id = $1 OR ka_user_id = $1', [req.params.id]);
    await pool.query('DELETE FROM ocene WHERE od_user_id = $1 OR za_user_id = $1', [req.params.id]);
    await pool.query('DELETE FROM lista_zelja WHERE user_id = $1', [req.params.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'Korisnik obrisan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/proizvod/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM lista_zelja WHERE proizvod_id = $1', [req.params.id]);
    await pool.query('DELETE FROM proizvodi WHERE id = $1', [req.params.id]);
    res.json({ message: 'Proizvod obrisan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OBJAVE PO USERID
app.get('/objave/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, tekst, slika, video, created_at FROM objave WHERE "userId" = $1 ORDER BY created_at DESC`,
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PORUKE ──
app.post('/poruka', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { ka_user_id, tekst } = req.body;

    if (!tekst || !ka_user_id) return res.status(400).json({ error: 'Nedostaju podaci' });
    if (decoded.userId === parseInt(ka_user_id)) return res.status(400).json({ error: 'Ne možete pisati sebi' });

    const result = await pool.query(
      `INSERT INTO poruke (od_user_id, ka_user_id, tekst) VALUES ($1, $2, $3) RETURNING id`,
      [decoded.userId, ka_user_id, tekst.trim()]
    );

    res.json({ message: 'Poruka poslata!', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/inbox', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT p.*, u.ime as "odIme", u.slika as "odSlika"
       FROM poruke p JOIN users u ON p.od_user_id = u.id
       WHERE p.ka_user_id = $1 ORDER BY p.created_at DESC`,
      [decoded.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/inbox/broj', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT COUNT(*) FROM poruke WHERE ka_user_id = $1 AND procitano = FALSE`,
      [decoded.userId]
    );
    res.json({ broj: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/poruka/:id/procitano', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await pool.query(
      `UPDATE poruke SET procitano = TRUE WHERE id = $1 AND ka_user_id = $2`,
      [req.params.id, decoded.userId]
    );
    res.json({ message: 'Označeno kao pročitano' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/poruka/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await pool.query(
      `DELETE FROM poruke WHERE id = $1 AND ka_user_id = $2`,
      [req.params.id, decoded.userId]
    );
    res.json({ message: 'Poruka obrisana' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OCENE ──
app.post('/ocena', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { za_user_id, ocena, komentar } = req.body;

    if (!za_user_id || !ocena) return res.status(400).json({ error: 'Nedostaju podaci' });
    if (ocena < 1 || ocena > 5) return res.status(400).json({ error: 'Ocena mora biti između 1 i 5' });
    if (decoded.userId === parseInt(za_user_id)) return res.status(400).json({ error: 'Ne možete oceniti sebe' });

    await pool.query(
      `INSERT INTO ocene (od_user_id, za_user_id, ocena, komentar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (od_user_id, za_user_id)
       DO UPDATE SET ocena = $3, komentar = $4, created_at = CURRENT_TIMESTAMP`,
      [decoded.userId, za_user_id, ocena, komentar || null]
    );

    res.json({ message: 'Ocena uspešno dodata!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/ocene/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.ime as "odIme", u.slika as "odSlika"
       FROM ocene o JOIN users u ON o.od_user_id = u.id
       WHERE o.za_user_id = $1 ORDER BY o.created_at DESC`,
      [req.params.userId]
    );

    const prosek = result.rows.length > 0
      ? (result.rows.reduce((sum, r) => sum + r.ocena, 0) / result.rows.length).toFixed(1)
      : null;

    res.json({ ocene: result.rows, prosek, ukupno: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/moja-ocena/:za_user_id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT * FROM ocene WHERE od_user_id = $1 AND za_user_id = $2`,
      [decoded.userId, req.params.za_user_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LISTA ŽELJA ──
app.post('/lista-zelja', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { proizvod_id } = req.body;

    if (!proizvod_id) return res.status(400).json({ error: 'Nedostaje proizvod_id' });

    await pool.query(
      `INSERT INTO lista_zelja (user_id, proizvod_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [decoded.userId, proizvod_id]
    );

    res.json({ message: 'Dodato u listu želja!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/lista-zelja/:proizvod_id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await pool.query(
      `DELETE FROM lista_zelja WHERE user_id = $1 AND proizvod_id = $2`,
      [decoded.userId, req.params.proizvod_id]
    );
    res.json({ message: 'Uklonjeno iz liste želja' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/lista-zelja', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT p.*, u.ime as "prodavacIme", lz.created_at as "dodato"
       FROM lista_zelja lz
       JOIN proizvodi p ON lz.proizvod_id = p.id
       JOIN users u ON p."userId" = u.id
       WHERE lz.user_id = $1
       ORDER BY lz.created_at DESC`,
      [decoded.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
