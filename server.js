const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

app.use(express.json());
app.use(cors());

const db = new sqlite3.Database('./users.db');

db.serialize(() => {
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Greška pri kreiranju tabele:', err.message);
    else console.log('Tabela users kreirana ili postoji');
  });
});

const JWT_SECRET = 'promeni-ovo-u-dug-random-string-za-produkciju-2026'; // OBAVEZNO PROMENI OVO!

// TEST RUTA – da vidiš da server živi
app.get('/test', (req, res) => {
  res.send('Backend radi! Trenutno vreme: ' + new Date().toISOString());
});

// JEDINA ruta za registraciju
app.post('/register', async (req, res) => {
  console.log('Primljen POST /register zahtev:', req.body); // vidi se u Render Logs-u!

  const { ime, email, lozinka, telefon, lokacija, nise, opis } = req.body;

  if (!ime || !email || !lozinka || !telefon || !lokacija) {
    return res.status(400).json({ error: 'Sva obavezna polja moraju biti popunjena' });
  }

  if (lozinka.length < 6) {
    return res.status(400).json({ error: 'Lozinka mora imati najmanje 6 karaktera' });
  }

  try {
    const hashedPassword = await bcrypt.hash(lozinka, 10);

    db.run(
      `INSERT INTO users (ime, email, password, telefon, lokacija, nise, opis)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ime,
        email,
        hashedPassword,
        telefon,
        lokacija,
        JSON.stringify(nise || []), // array kao string
        opis || null
      ],
      function (err) {
        if (err) {
          console.error('Greška pri insertu:', err.message);
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email već postoji' });
          }
          return res.status(500).json({ error: 'Greška na serveru' });
        }

        const token = jwt.sign(
          { userId: this.lastID, email },
          JWT_SECRET,
          { expiresIn: '30d' }
        );

        res.status(201).json({
          message: 'Registracija uspešna',
          token,
          user: { id: this.lastID, ime, email }
        });
      }
    );
  } catch (err) {
    console.error('Greška u registraciji:', err.message);
    res.status(500).json({ error: 'Greška na serveru' });
  }
});

const port = process.env.PORT || 3000;
app.post('/login', async (req, res) => {
  const { email, lozinka } = req.body;

  if (!email || !lozinka) {
    return res.status(400).json({ error: 'Email i lozinka su obavezni' });
  }

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Pogrešan email ili lozinka' });
    }

    const isMatch = await bcrypt.compare(lozinka, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Pogrešan email ili lozinka' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

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
  });
});
app.get('/profile', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1]; // Bearer token

  if (!token) {
    return res.status(401).json({ error: 'Niste ulogovani' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        console.error('Greška u bazi:', err);
        return res.status(500).json({ error: 'Greška na serveru' });
      }

      if (!user) {
        return res.status(404).json({ error: 'Korisnik nije pronađen' });
      }

      res.json({
        ime: user.ime,
        email: user.email,
        telefon: user.telefon,
        lokacija: user.lokacija,
        nise: JSON.parse(user.nise || '[]'),
        opis: user.opis || '',
        registeredAt: user.created_at
      });
    });
  } catch (err) {
    console.error('Greška pri verifikaciji tokena:', err);
    res.status(401).json({ error: 'Nevažeći token' });
  }
});

// Ruta za dodaj proizvod (npr. tabela 'proizvodi' ako imaš)
db.run(`
  CREATE TABLE IF NOT EXISTS proizvodi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    naziv TEXT,
    opis TEXT,
    cena NUMBER,
    slikaUrl TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.post('/add-proizvod', async (req, res) => {
  const { naziv, opis, cena, slikaUrl } = req.body;
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Nema tokena' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalidan token' });
  }

  db.run(
    `INSERT INTO proizvodi (userId, naziv, opis, cena, slikaUrl) VALUES (?, ?, ?, ?, ?)`,
    [decoded.userId, naziv, opis, cena, slikaUrl || null],
    function (err) {
      if (err) {
        console.error('Greška pri dodavanju proizvoda:', err.message);
        return res.status(500).json({ error: 'Greška na serveru' });
      }
      res.json({ message: 'Proizvod uspešno dodan', proizvodId: this.lastID });
    }
  );
});

// Ruta za get profil (ako hoćeš da učitaš najnovije podatke iz baze)
app.get('/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Nema tokena' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalidan token' });
  }

  db.get(`SELECT * FROM users WHERE id = ?`, [decoded.userId], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'Korisnik ne postoji' });
    }

    user.nise = user.nise ? JSON.parse(user.nise) : [];

    res.json({ user });
  });
});
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
