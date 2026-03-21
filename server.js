const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// RUČNI CORS
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

// Middleware za autentifikaciju (OVO JE BILO NEDOSTAJALO)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Niste ulogovani' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Nevažeći token' });
    }
    req.user = user; // { userId, email }
    next();
  });
}

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
  `);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS objave (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      tekst TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);
});

const JWT_SECRET = 'moj-super-dug-secret-2026-tajni-kljuc-1234567890abcdef';

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
        nise: user.nise ? JSON.parse(user.nise) : []
      }
    });
  });
});

// GET PROFIL
app.get('/profile', authenticateToken, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Korisnik nije pronađen' });

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
});

// OBJAVI NOVOST
app.post('/objavi-novost', authenticateToken, (req, res) => {
  const { tekst } = req.body;

  if (!tekst || tekst.trim() === '') return res.status(400).json({ error: 'Tekst objave ne može biti prazan' });

  db.run(
    `INSERT INTO objave (userId, tekst) VALUES (?, ?)`,
    [req.user.userId, tekst.trim()],
    function (err) {
      if (err) return res.status(500).json({ error: 'Greška na serveru' });
      res.json({ message: 'Objava uspešno dodata!', objavaId: this.lastID });
    }
  );
});

// MOJE OBJAVE
app.get('/moje-objave', authenticateToken, (req, res) => {
  db.all(
    `SELECT id, tekst, created_at 
     FROM objave 
     WHERE userId = ? 
     ORDER BY created_at DESC`,
    [req.user.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Greška na serveru' });
      res.json(rows);
    }
  );
});

// SVI PRODAVCi
app.get('/svi-prodavci', (req, res) => {
  db.all(
    `SELECT id, ime, opis, slika, lokacija, nise 
     FROM users 
     ORDER BY ime ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Greška na serveru' });

      const prodavci = rows.map(row => ({
        id: row.id,
        ime: row.ime || 'Bez imena',
        opis: row.opis || 'Porodična proizvodnja svežih domaćih proizvoda.',
        slika: row.slika || 'https://via.placeholder.com/400x220?text=' + encodeURIComponent(row.ime || 'Prodavac'),
        lokacija: row.lokacija || 'Lokacija nije navedena',
        nise: row.nise ? JSON.parse(row.nise) : []
      }));

      res.json(prodavci);
    }
  );
});

// DODAJ PROIZVOD
app.post('/dodaj-proizvod', authenticateToken, (req, res) => {
  const { naziv, opis, cena, slikaUrl, glavnaNisa, podnisa } = req.body;

  if (!naziv || !cena || !glavnaNisa) {
    return res.status(400).json({ poruka: 'Popunite obavezna polja' });
  }

  db.run(
    `INSERT INTO proizvodi (userId, naziv, opis, cena, slikaUrl, glavnaNisa, podnisa)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.userId, naziv, opis || null, cena, slikaUrl || null, glavnaNisa, podnisa || ''],
    function (err) {
      if (err) return res.status(500).json({ poruka: 'Greška na serveru' });
      res.json({ message: 'Proizvod uspešno dodan', proizvodId: this.lastID });
    }
  );
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server startovan na portu ${port}`);
});
