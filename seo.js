'use strict';
/*
 * Auffindbarkeit: robots.txt, sitemap.xml, „nicht indexieren“ für alles Interne und strukturierte Daten (Schema.org)
 * für die Startseite. Adressen kommen aus der Anfrage (https://<host>), damit Test-, Render- und eigene Domain stimmen.
 */
const express = require('express');
const features = require('./features');
const profiles = require('./profiles');
const areas = require('./areas');
const { getSetting } = require('./db');

// Seiten und Schnittstellen, die nie in einer Suchmaschine auftauchen sollen
const PRIVATE = /^\/(api|dashboard|login|registrieren|register|bewerbung|vertrag|rechnung|aktenauszug|offline|aufwachen|fivenet-import|media|js\/dashboard)(\/|\.|$|\?)/;
const originOf = (req) => `${req.protocol}://${req.get('host')}`;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const router = express.Router();

/** Früh eingehängt, damit auch API und Weiterleitungen den Hinweis tragen. */
const noindex = (req, res, next) => {
  if (PRIVATE.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
};

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /dashboard', 'Disallow: /login', 'Disallow: /registrieren', 'Disallow: /bewerbung', 'Disallow: /vertrag', 'Disallow: /rechnung', 'Disallow: /aktenauszug', '', `Sitemap: ${originOf(req)}/sitemap.xml`, ''].join('\n')
  );
});

/** Öffentliche Seiten: Startseite, Karriere (wenn eingeschaltet), Profile der sichtbaren Anwälte. */
function publicPaths() {
  const paths = ['/'];
  if (features.on('karriere')) paths.push('/karriere');
  for (const slug of profiles.slugMap().values()) paths.push(`/team/${slug}`);
  return paths;
}
router.get('/sitemap.xml', (req, res) => {
  const origin = originOf(req);
  const body = publicPaths()
    .map((p, i) => `  <url><loc>${xml(origin + (p === '/' ? '/' : p))}</loc><priority>${i === 0 ? '1.0' : p === '/karriere' ? '0.6' : '0.5'}</priority></url>`)
    .join('\n');
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

/** <head>-Ergänzungen für die öffentlichen Seiten: kanonische Adresse, og:url und – auf der Startseite – Schema.org „LegalService“. */
function headExtras(page, origin) {
  const url = origin + (page === 'karriere' ? '/karriere' : '/');
  const out = [`<link rel="canonical" href="${xml(url)}">`, `<meta property="og:url" content="${xml(url)}">`];
  if (page === 'index') {
    const contact = String(getSetting('firm_contact', '') || '');
    const email = (contact.match(/[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}/i) || [])[0];
    const data = {
      '@context': 'https://schema.org',
      '@type': 'LegalService',
      name: 'Pake & Scha Legal Consulting',
      url,
      logo: `${origin}/img/logo.png`,
      image: `${origin}/img/og-image.png`,
      description: 'Kanzlei für Zivil-, Straf- und Verfassungsrecht in Los Santos – Mandat online anfragen, Termine vereinbaren.',
      areaServed: 'Los Santos',
      address: { '@type': 'PostalAddress', streetAddress: require('./models').firmSeat() },
      knowsAbout: areas.list({ activeOnly: true }).map((a) => a.name),
    };
    if (email) data.email = email;
    out.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  }
  return out.join('\n    ');
}

module.exports = { router, noindex, headExtras, publicPaths };
