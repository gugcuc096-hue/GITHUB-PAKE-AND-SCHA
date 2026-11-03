/*
 * Website in Unterseiten: alte Links auf Abschnitte der früheren Startseite (Lesezeichen, Discord-Nachrichten,
 * /#honorar …) führen sofort auf die neue Unterseite – noch bevor etwas gezeichnet wird.
 */
(function () {
  'use strict';
  if (location.pathname !== '/' || !location.hash) return;
  var MAP = {
    rechner: '/honorare#rechner',
    honorar: '/honorare#honorar',
    vip: '/honorare#vip',
    team: '/anwaelte',
    raenge: '/kanzlei#raenge',
    stimmen: '/kanzlei#stimmen',
    karriere: '/kanzlei#karriere',
    kontakt: '/kontakt',
    anliegen: '/kontakt#anliegen',
    faq: '/kontakt#faq',
  };
  var to = MAP[location.hash.slice(1)];
  if (!to) return;
  var parts = to.split('#');
  location.replace(parts[0] + location.search + (parts[1] ? '#' + parts[1] : ''));
})();
