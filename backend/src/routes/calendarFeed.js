const express = require('express');

const { db } = require('../db/conn');

const router = express.Router();

function getUsernameForToken(token) {
  return new Promise((resolve, reject) => {
    db.get('SELECT username FROM calendar_tokens WHERE token = ?', [token], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row?.username || null);
    });
  });
}

function loadBons() {
  return new Promise((resolve, reject) => {
    db.get('SELECT value_json FROM shared_state WHERE key = ?', ['bons'], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const parsed = row?.value_json ? JSON.parse(row.value_json) : [];
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

function escapeICSText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function rdvEntriesFor(bon) {
  const raw = bon.raw || {};
  const entries = [];

  if (raw['bon.rdv']) {
    entries.push({ date: raw['bon.rdv'], heure: raw['bon.rdv_heure'] || '' });
  }

  (Array.isArray(bon.rdv_plus) ? bon.rdv_plus : []).forEach((rdv) => {
    if (rdv.date) {
      entries.push({ date: rdv.date, heure: rdv.heure || '' });
    }
  });

  return entries;
}

function locationFor(bon) {
  const raw = bon.raw || {};
  if (raw['bon.adresse_chantier_diff'] === 'oui' && raw['bon.adresse_chantier']) {
    return [raw['bon.adresse_chantier'], [raw['bon.chantier_code_postal'], raw['bon.chantier_ville']].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
  }
  return [raw['bon.client_adresse'], [raw['bon.client_code_postal'], raw['bon.client_ville']].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}

function buildEvent(bon, entry, index) {
  const dateDigits = String(entry.date).replace(/-/g, '');
  if (!/^\d{8}$/.test(dateDigits)) return '';

  const summary = escapeICSText(`${bon.client || 'Chantier'} — ${bon.objet || 'RDV'}`);
  const location = escapeICSText(locationFor(bon));
  const description = escapeICSText(`Devis/BT no ${bon.num_devis || '-'}\nÉquipe : ${(bon.team || []).join(', ') || '-'}`);
  const uid = `bon-${bon.id}-rdv-${index}@bordanova`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let dtstartLine;
  let dtendLine;

  const heure = String(entry.heure || '').match(/^(\d{2}):(\d{2})$/);
  if (heure) {
    const [, hh, mm] = heure;
    const startTime = `${dateDigits}T${hh}${mm}00`;
    const endHour = String(Math.min(23, Number(hh) + 1)).padStart(2, '0');
    const endTime = `${dateDigits}T${endHour}${mm}00`;
    dtstartLine = `DTSTART:${startTime}`;
    dtendLine = `DTEND:${endTime}`;
  } else {
    const d = new Date(`${entry.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const nextDay = d.toISOString().slice(0, 10).replace(/-/g, '');
    dtstartLine = `DTSTART;VALUE=DATE:${dateDigits}`;
    dtendLine = `DTEND;VALUE=DATE:${nextDay}`;
  }

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    dtstartLine,
    dtendLine,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : '',
    `DESCRIPTION:${description}`,
    'END:VEVENT',
  ]
    .filter(Boolean)
    .join('\r\n');
}

router.get('/:token.ics', async (req, res) => {
  try {
    const username = await getUsernameForToken(req.params.token);
    if (!username) {
      return res.status(404).send('Not found');
    }

    const bons = await loadBons();
    const mine = bons.filter(
      (bon) => (bon.team || []).includes(username) || (bon.encadrants || []).includes(username),
    );

    const events = [];
    mine.forEach((bon) => {
      rdvEntriesFor(bon).forEach((entry, index) => {
        const event = buildEvent(bon, entry, index);
        if (event) events.push(event);
      });
    });

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Bordanova//RDV//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Bordanova - RDV',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.send(ics);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

module.exports = router;
