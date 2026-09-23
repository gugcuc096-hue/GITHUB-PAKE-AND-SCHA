'use strict';
/**
 * Legt einmalig ein Kanzleileitung-Konto (role: admin) an, da die Registrierung
 * über /register.html nur mandant/anwalt/richter erlaubt.
 *
 * Aufruf: npm run seed:admin -- "Name Nachname" mail@example.com einPasswort123
 */
const { db } = require('../db');
const { hashPassword } = require('../auth');

const [displayName, email, password] = process.argv.slice(2);

if (!displayName || !email || !password) {
  console.error('Verwendung: npm run seed:admin -- "Name Nachname" mail@example.com passwort (mind. 10 Zeichen)');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Das Passwort muss mindestens 10 Zeichen lang sein.');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', display_name = ?, password_hash = ?, active = 1 WHERE id = ?").run(
    displayName,
    hashPassword(password),
    existing.id
  );
  console.log(`Bestehender Nutzer ${email} wurde zur Kanzleileitung (admin) gemacht.`);
} else {
  db.prepare('INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run(
    email.toLowerCase(),
    hashPassword(password),
    displayName,
    'admin'
  );
  console.log(`Kanzleileitungs-Konto für ${email} wurde angelegt.`);
}
