import { DAY_LABELS_LONG, DAYS, dayNumbers, formatHours, weekTitle, type Schedule } from './model';

/** Names and notes are user text: never interpolate them raw into markup. */
function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The schedule laid out for paper: A4 landscape, the whole grid on one page.
 *
 * Each day gets three columns — start, end, hours — which is how the printed
 * sheet a bakery actually pins up is read: the manager checks a start time
 * without decoding a range. A day off greys the two time columns and shows
 * 0:00 in the hours one.
 *
 * Built as HTML rather than captured from the screen so the text stays
 * vectorial: a 15-row table rasterised at phone resolution is unreadable once
 * printed. Nothing from the app's interface appears here.
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
      ${anyOvertime ? '<th class="tot" rowspan="2">Supp.</th>' : ''}
      <th class="tot" rowspan="2">Total</th>
    </tr>
    <tr class="subhead">
      ${DAY_LABELS_LONG.map(() => '<th>Début</th><th>Fin</th><th class="h">Heures</th>').join('')}
    </tr>`;

  const rows = schedule.employees.map((e) => {
    const cells = Array.from({ length: DAYS }, (_, i) => {
      const day = e.days[i] || null;
      if (day?.off) {
        // The greyed block spans start and end, exactly as on the paper sheet.
        return '<td class="off" colspan="2"></td><td class="h off-h">0:00</td>';
      }
      const worked = day?.minutes || 0;
      return `<td>${escapeHtml(day?.start || '')}</td>`
        + `<td>${escapeHtml(day?.end || '')}</td>`
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
      <td class="tot">${formatHours(schedule.grand_total_minutes)}</td>
    </tr>`;

  const note = `
    <table class="notebox">
      <tr><th>NOTE</th></tr>
      <tr><td>${escapeHtml(schedule.notes?.trim() || '')}</td></tr>
    </table>`;

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8" /><title>${escapeHtml(weekTitle(schedule.week_start))}</title>
<style>
  /* A4 landscape, which is what opens the print sheet on Paysage rather than
     Portrait. Note that mixing explicit millimetres with the landscape keyword
     is invalid CSS and makes the whole declaration be dropped. */
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #000; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.6pt solid #000; padding: 1.1mm 0.6mm; text-align: center; font-size: 7.2pt; }
  th { background: #fff; font-weight: 700; }
  th.dayhead { border-bottom: 0; }
  .dayname { display: block; font-size: 8pt; }
  .daynum { display: block; font-weight: 400; font-size: 7pt; }
  tr.subhead th { font-size: 6pt; font-weight: 400; padding: 0.6mm 0; }
  td.name, th.name { text-align: left; width: 11%; font-weight: 700; padding-left: 1.5mm; font-size: 7.5pt; }
  td.h, th.h { font-weight: 700; }
  td.tot, th.tot { width: 6%; font-weight: 700; }
  /* Days off keep their grey fill on paper — that is how they read at a glance. */
  td.off { background: #b8b8b8; }
  td.off-h { background: #d8d8d8; }
  tr.totals td { font-weight: 700; }
  .notebox { margin-top: 3mm; }
  .notebox th { font-size: 7pt; letter-spacing: 1pt; padding: 1mm; }
  .notebox td { height: 16mm; vertical-align: top; text-align: center; font-size: 8.5pt; padding: 2mm; }
</style></head>
<body>
  <h1>${escapeHtml(weekTitle(schedule.week_start))}</h1>
  <table><thead>${header}</thead><tbody>${rows}${totals}</tbody></table>
  ${note}
</body></html>`;
}
