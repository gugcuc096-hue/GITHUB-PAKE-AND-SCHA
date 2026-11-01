'use strict';
/* Geheimes Mandat: Akte nur für das Board of Partners (und die vom Board zugewiesenen Anwälte) sichtbar */

module.exports = function up({ db, addColumn }) {
  addColumn('cases', 'board_only', 'INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cases_board_only ON cases(board_only) WHERE board_only = 1');
};
