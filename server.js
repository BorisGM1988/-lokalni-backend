const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// RUČNI CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10mb' }));

// PostgreSQL konekcija
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Kreiranje tabela
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Dodaj kolone ako ne postoje (za stare baze)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS slika TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_slika TEXT`);

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS objave (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        tekst TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Baza inicijalizovana uspešno!');
  } catch (err) {
    console.error('Greška pri inicijalizaciji baze:', err.message);
  }
}

initDB();

const JWT_SECRET = 'promeni-ovo-u-dug-random-string-za-produkciju-2026';

// TEST
app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// REGISTRACIJA
app.post('/register', async (req, res) => {
  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    const result = await pool.query(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ime, email, hashedPassword, telefon, lokacija, JSON.stringify(nise || []), opis || null]
    );

    const userId = result.rows[0].id;
    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'Registracija uspešna',
      token,
      user: { id: userId, ime, email }
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email već postoji' });
    }
    console.error(err);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// LOGIN
app.post('/login', async (req, res) => {
  const { email, lozinka } = req.body;

  if (!email || !lozinka) return res.status(400).json({ error: 'Email i lozinka su obavezni' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });

    const isMatch = await bcrypt.compare(lozinka, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });

    const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '30d' });

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
        nise: user.nise ? JSON.parse(user.nise) : []
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
        `SELECT id, ime, email, telefon, lokacija, opis, nise, slika, cover_slika, created_at as "registeredAt"
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
      coverSlika: user.cover_slika || ''
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// UPDATE PROFILA (ime, opis, telefon, lokacija, slike)
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

    await pool.query(
      `UPDATE users SET ${polja.join(', ')} WHERE id = $${i}`,
      vrednosti
    );

    res.json({ message: 'Profil uspešno izmenjen!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri izmeni profila' });
  }
});

// OBJAVI NOVOST
app.post('/objavi-novost', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { tekst } = req.body;

    if (!tekst || tekst.trim() === '') return res.status(400).json({ error: 'Tekst objave ne može biti prazan' });

    const result = await pool.query(
      `INSERT INTO objave ("userId", tekst) VALUES ($1, $2) RETURNING id`,
      [decoded.userId, tekst.trim()]
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
      `SELECT id, tekst, created_at FROM objave WHERE "userId" = $1 ORDER BY created_at DESC`,
      [decoded.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// SVI PRODAVCI
app.get('/svi-prodavci', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, ime, opis, slika, lokacija, nise FROM users ORDER BY ime ASC`
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
    const { naziv, cena, kolicina, glavnaNisa, podnisa, opis } = req.body;

    if (!naziv || !cena || !kolicina || !glavnaNisa) {
      return res.status(400).json({ error: 'Obavezna polja nisu popunjena' });
    }

    const result = await pool.query(
      `INSERT INTO proizvodi ("userId", naziv, opis, cena, kolicina, "glavnaNisa", podnisa)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [decoded.userId, naziv, opis || null, cena, kolicina, glavnaNisa, podnisa || null]
    );

    res.status(201).json({
      message: 'Proizvod uspešno izložen na pijac!',
      proizvodId: result.rows[0].id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Greška pri dodavanju proizvoda' });
  }
});

// GET PROIZVODI
app.get('/proizvodi', async (req, res) => {
  const { glavnaNisa, podnisa } = req.query;

  try {
    let sql = `
      SELECT p.*, u.ime as "prodavacIme", u.lokacija as "prodavacLokacija"
      FROM proizvodi p
      JOIN users u ON p."userId" = u.id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;

    if (glavnaNisa) {
      sql += ` AND p."glavnaNisa" = $${i++}`;
      params.push(glavnaNisa);
    }
    if (podnisa) {
      sql += ` AND p.podnisa = $${i++}`;
      params.push(podnisa);
    }

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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
