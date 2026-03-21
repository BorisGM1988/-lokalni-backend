const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// RUČNI CORS – radi i bez cors paketa ako treba
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

const db = new sqlite3.Database('./users.db');

db.serialize(() => {
  // Tabela korisnika (sa slikama)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ime TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      telefon TEXT,
      lokacija TEXT,
      nise TEXT,
      opis TEXT,
      slika TEXT,          -- URL profilne slike (sa ImgBB)
      coverSlika TEXT,     -- URL naslovne slike (sa ImgBB)
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Greška pri kreiranju tabele users:', err.message);
    else console.log('Tabela users kreirana ili postoji');
  });

  // Tabela proizvoda (sa nišama)
  db.run(`
    CREATE TABLE IF NOT EXISTS proizvodi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      naziv TEXT,
      opis TEXT,
      cena NUMBER,
      kolicina NUMBER,
      glavnaNisa TEXT,
      podnisa TEXT,
      slikaUrl TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `, (err) => {
    if (err) console.error('Greška pri kreiranju tabele proizvodi:', err.message);
    else console.log('Tabela proizvodi kreirana ili postoji');
  });

  // Tabela objava
  db.run(`
    CREATE TABLE IF NOT EXISTS objave (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      tekst TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `, (err) => {
    if (err) console.error('Greška pri kreiranju tabele objave:', err.message);
    else console.log('Tabela objave kreirana ili postoji');
  });
});

const JWT_SECRET = 'promeni-ovo-u-dug-random-string-za-produkciju-2026';

// TEST RUTA
app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// REGISTRACIJA
app.post('/register', async (req, res) => {
  console.log('Primljen POST /register:', req.body);

  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    db.run(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ime, email, hashedPassword, telefon, lokacija, JSON.stringify(nise || []), opis || null],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email već postoji' });
          }
          return res.status(500).json({ error: 'Greška na serveru' });
        }

        const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
          message: 'Registracija uspešna',
          token,
          user: { id: this.lastID, ime, email }
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

// LOGIN
app.post('/login', async (req, res) => {
  const { email, lozinka } = req.body;

  if (!email || !lozinka) return res.status(400).json({ error: 'Email i lozinka su obavezni' });

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Pogrešan email ili lozinka' });

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
        nise: user.nise ? JSON.parse(user.nise) : [],
        slika: user.slika || '',
        coverSlika: user.coverSlika || ''
      }
    });
  });
});

// GET PROFIL
app.get('/profile', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niste ulogovani' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    db.get('SELECT * FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err || !user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

      res.json({
        ime: user.ime,
        email: user.email,
        telefon: user.telefon,
        lokacija: user.lokacija,
        nise: JSON.parse(user.nise || '[]'),
        opis: user.opis || '',
        registeredAt: user.created_at,
        slika: user.slika || '',
        coverSlika: user.coverSlika || ''
      });
    });
  } catch (err) {
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// UPDATE PROFILA (tekst + slike preko ImgBB)
app.post('/profile/update', authenticateToken, async (req, res) => {
  console.log('Primljen POST /profile/update');

  const updates = {};

  // Profilna slika (base64)
  if (req.body.slikaBase64) {
    try {
      const response = await fetch('https://api.imgbb.com/1/upload?key=' + process.env.IMGBB_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: req.body.slikaBase64 })
      });
      const data = await response.json();
      if (data.success) {
        updates.slika = data.data.url;
      } else {
        throw new Error(data.error.message || 'ImgBB greška');
      }
    } catch (err) {
      console.error('ImgBB error (profilna):', err);
      return res.status(500).json({ poruka: 'Greška pri upload-u profilne slike' });
    }
  }

  // Naslovna slika (base64)
  if (req.body.coverSlikaBase64) {
    try {
      const response = await fetch('https://api.imgbb.com/1/upload?key=' + process.env.IMGBB_API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ image: req.body.coverSlikaBase64 })
      });
      const data = await response.json();
      if (data.success) {
        updates.coverSlika = data.data.url;
      } else {
        throw new Error(data.error.message || 'ImgBB greška');
      }
    } catch (err) {
      console.error('ImgBB error (naslovna):', err);
      return res.status(500).json({ poruka: 'Greška pri upload-u naslovne slike' });
    }
  }

  // Tekstualna polja
  if (req.body.ime) updates.ime = req.body.ime;
  if (req.body.opis) updates.opis = req.body.opis;
  if (req.body.telefon) updates.telefon = req.body.telefon;
  if (req.body.lokacija) updates.lokacija = req.body.lokacija;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ poruka: 'Nema izmena' });
  }

  const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = [...Object.values(updates), req.user.id];

  db.run(`UPDATE users SET ${setClause} WHERE id = ?`, values, function(err) {
    if (err) {
      console.error('DB error:', err.message);
      return res.status(500).json({ poruka: 'Greška pri čuvanju' });
    }
    res.json({ success: true, message: 'Profil ažuriran', updates });
  });
});

// DODAJ PROIZVOD (sa glavnom nišom i podnišom)
app.post('/dodaj-proizvod', authenticateToken, (req, res) => {
  console.log('Primljen POST /dodaj-proizvod:', req.body);

  const { naziv, cena, kolicina, glavnaNisa, podnisa } = req.body;

  if (!naziv || !cena || !kolicina || !glavnaNisa) {
    return res.status(400).json({ poruka: 'Popunite obavezna polja' });
  }

  const token = req.headers.authorization?.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ poruka: 'Nevažeći token' });
  }

  db.run(
    `INSERT INTO proizvodi (userId, naziv, cena, kolicina, glavnaNisa, podnisa)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [decoded.userId, naziv, cena, kolicina, glavnaNisa, podnisa || ''],
    function(err) {
      if (err) {
        console.error('Greška pri dodavanju proizvoda:', err.message);
        return res.status(500).json({ poruka: 'Greška na serveru' });
      }
      res.json({ success: true, message: 'Proizvod dodan', proizvodId: this.lastID });
    }
  );
});

// OSTALE RUTE (ostaju iste)
app.post('/login', async (req, res) => { /* tvoj originalni kod */ });
app.get('/svi-prodavci', (req, res) => { /* tvoj originalni kod */ });
app.post('/objavi-novost', (req, res) => { /* tvoj originalni kod */ });
app.get('/moje-objave', (req, res) => { /* tvoj originalni kod */ });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
