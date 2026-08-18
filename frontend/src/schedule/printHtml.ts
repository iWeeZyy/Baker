import { DAY_LABELS_LONG, DAYS, dayNumbers, formatHours, weekTitle, type Schedule } from './model';

/** Names and notes are user text: never interpolate them raw into markup. */
function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Column widths as percentages of the table, declared once in a <colgroup> and
// applied by `table-layout: fixed`. This is what guarantees that every vertical
// rule runs straight from the header to the totals: the browser never measures
// content to decide a width.
const NAME_PCT = 10.5;
const TOTAL_PCT = 6.3;

function colgroup(withOvertime: boolean): string {
  const fixed = NAME_PCT + TOTAL_PCT * (withOvertime ? 2 : 1);
  const perDay = (100 - fixed) / DAYS;
  const start = perDay * 0.33;
  const hours = perDay - start * 2;

  const dayCols = Array.from({ length: DAYS }, () =>
    `<col style="width:${start.toFixed(4)}%" />`
    + `<col style="width:${start.toFixed(4)}%" />`
    + `<col style="width:${hours.toFixed(4)}%" />`,
  ).join('');

  return `<colgroup>
    <col style="width:${NAME_PCT}%" />
    ${dayCols}
    ${withOvertime ? `<col style="width:${TOTAL_PCT}%" />` : ''}
    <col style="width:${TOTAL_PCT}%" />
  </colgroup>`;
}

/**
 * The schedule laid out for paper: A4 landscape, the whole grid on one page.
 *
 * Each day gets three columns — start, end, hours — which is how the printed
 * sheet a bakery pins up is read. Built as HTML rather than captured from the
 * screen so the text stays vectorial: a 15-row table rasterised at phone
 * resolution is unreadable once printed. Nothing from the app's interface
 * appears here.
 */
export function scheduleHtml(schedule: Schedule): string {
  const numbers = dayNumbers(schedule.week_start);
  const anyOvertime = schedule.employees.some(e => (e.overtime_minutes || 0) > 0);

  const header = `
    <tr>
      <th class="name" rowspan="2">Nom</th>
      ${DAY_LABELS_LONG.map((label, i) => `
        <th colspan="3" class="dayhead">
          <span class="dayname">${label}</span><span class="daynum">${numbers[i]}</span>
        </th>`).join('')}
      ${anyOvertime ? '<th class="accent" rowspan="2">Supp.</th>' : ''}
      <th class="accent" rowspan="2">Total</th>
    </tr>
    <tr class="subhead">
      ${DAY_LABELS_LONG.map(() => '<th>Début</th><th>Fin</th><th>Heures</th>').join('')}
    </tr>`;

  const rows = schedule.employees.map((e) => {
    const cells = Array.from({ length: DAYS }, (_, i) => {
      const day = e.days[i] || null;
      if (day?.off) {
        return '<td class="off" colspan="2"></td><td class="off-h">0:00</td>';
      }
      const worked = day?.minutes || 0;
      return `<td class="time">${escapeHtml(day?.start || '')}</td>`
        + `<td class="time">${escapeHtml(day?.end || '')}</td>`
        + `<td class="h">${worked ? formatHours(worked) : ''}</td>`;
    }).join('');

    return `
      <tr>
        <td class="name">${escapeHtml(e.name)}</td>
        ${cells}
        ${anyOvertime ? `<td class="tot">${e.overtime_minutes ? formatHours(e.overtime_minutes) : ''}</td>` : ''}
        <td class="tot">${formatHours(e.total_minutes ?? 0)}</td>
      </tr>`;
  }).join('');

  const totals = `
    <tr class="totals">
      <td class="name">Total / jour</td>
      ${schedule.day_totals.map(m => `<td colspan="2"></td><td class="h">${formatHours(m)}</td>`).join('')}
      ${anyOvertime ? '<td></td>' : ''}
      <td class="grand">${formatHours(schedule.grand_total_minutes)}</td>
    </tr>`;

  const people = schedule.employees.length;

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8" /><title>${escapeHtml(weekTitle(schedule.week_start))}</title>
<style>
  /* A4 landscape, which is what opens the print sheet on Paysage rather than
     Portrait. Mixing explicit millimetres with the landscape keyword is invalid
     CSS and would make the whole declaration be dropped. */
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #2A1F1A;
    font-family: -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .brand { font-size: 7pt; letter-spacing: 2.6pt; color: #8B7D72; font-weight: 600; }
  h1 { font-size: 17pt; margin: 1mm 0 1mm; font-weight: 700; }
  .sub { font-size: 8.5pt; color: #8B7D72; margin-bottom: 4mm; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td {
    border: 0.4pt solid #D8CEC2; padding: 1.3mm 0.5mm;
    text-align: center; font-size: 7.4pt; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis;
  }
  th { background: #F3EFEA; font-weight: 700; }
  th.dayhead { border-bottom: 0; padding-bottom: 0.6mm; }
  .dayname { display: block; font-size: 8.2pt; }
  .daynum { display: block; font-weight: 400; font-size: 6.8pt; color: #8B7D72; }
  tr.subhead th { background: #FAF8F5; font-size: 6.2pt; font-weight: 600; color: #8B7D72; letter-spacing: 0.3pt; padding: 0.7mm 0; }
  td.name, th.name { text-align: left; font-weight: 700; padding-left: 2mm; font-size: 8pt; background: #FAF8F5; }
  td.time { color: #4A3D36; }
  td.h { font-weight: 700; }
  th.accent { background: #F0DAC6; color: #8B4527; }
  td.tot { background: #FBF4EC; color: #8B4527; font-weight: 700; }
  /* Days off keep their grey fill on paper — that is how they read at a glance. */
  td.off { background: #E3DCD2; }
  td.off-h { background: #EDE7DF; color: #8B7D72; font-weight: 700; }
  tr.totals td { background: #F3EFEA; font-weight: 700; }
  tr.totals td.name { text-align: left; }
  /* More specific than the tr.totals td rule above, which would otherwise win
     on the background and leave white text on a pale cell. */
  tr.totals td.grand { background: #8B4527; color: #FFFFFF; font-weight: 700; }

  /* The note is plainly detached from the grid above it. */
  .note { margin-top: 4mm; border: 0.4pt solid #D8CEC2; border-radius: 2mm; padding: 3mm; min-height: 18mm; }
  .note-label { font-size: 6.5pt; letter-spacing: 1.6pt; color: #8B7D72; font-weight: 700; margin-bottom: 1.5mm; }
  .note-text { font-size: 9pt; }
</style></head>
<body>
  <div class="brand">BAKER · LE FOURNIL</div>
  <h1>${escapeHtml(weekTitle(schedule.week_start))}</h1>
  <div class="sub">${people} personne${people > 1 ? 's' : ''} &nbsp;·&nbsp; Total de la semaine ${formatHours(schedule.grand_total_minutes)}</div>
  <table>${colgroup(anyOvertime)}<thead>${header}</thead><tbody>${rows}${totals}</tbody></table>
  <div class="note">
    <div class="note-label">NOTE</div>
    <div class="note-text">${escapeHtml(schedule.notes?.trim() || '')}</div>
  </div>
</body></html>`;
}
