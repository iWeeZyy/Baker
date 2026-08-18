import { DAY_LABELS, DAYS, cellText, dayNumbers, formatHours, weekTitle, type Schedule } from './model';

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
 * Built as HTML rather than captured from the screen so the text stays
 * vectorial — a 15-row table rasterised from a phone screen is unreadable once
 * printed. Nothing from the app's interface appears here: no navigation, no
 * buttons, only the grid a manager pins up in the bakery.
 */
export function scheduleHtml(schedule: Schedule): string {
  const numbers = dayNumbers(schedule.week_start);
  const anyOvertime = schedule.employees.some(e => (e.overtime_minutes || 0) > 0);

  const header = `
    <tr>
      <th class="name">Nom</th>
      ${DAY_LABELS.map((label, i) => `<th><span class="day">${label}</span><span class="num">${numbers[i]}</span></th>`).join('')}
      ${anyOvertime ? '<th class="tot">Supp.</th>' : ''}
      <th class="tot">Total</th>
    </tr>`;

  const rows = schedule.employees.map((e) => {
    const cells = Array.from({ length: DAYS }, (_, i) => {
      const day = e.days[i] || null;
      const off = !!day?.off;
      return `<td class="${off ? 'off' : ''}">${escapeHtml(cellText(day))}</td>`;
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
      ${schedule.day_totals.map(m => `<td>${formatHours(m)}</td>`).join('')}
      ${anyOvertime ? '<td></td>' : ''}
      <td class="tot">${formatHours(schedule.grand_total_minutes)}</td>
    </tr>`;

  const note = schedule.notes?.trim()
    ? `<div class="note"><div class="note-label">NOTE</div><div>${escapeHtml(schedule.notes)}</div></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1c1c1c; }
  h1 { font-size: 17pt; margin: 0 0 2mm; letter-spacing: .2pt; }
  .sub { font-size: 9pt; color: #666; margin-bottom: 4mm; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 0.5pt solid #999; padding: 1.6mm 1mm; text-align: center; font-size: 9pt; }
  th { background: #ececec; font-weight: 600; }
  th .day { display: block; }
  th .num { display: block; font-weight: 400; font-size: 7.5pt; color: #555; }
  td.name, th.name { text-align: left; width: 17%; font-weight: 600; padding-left: 2mm; }
  td.tot, th.tot { width: 9%; font-weight: 700; background: #f6f6f6; }
  /* Days off keep their grey fill on paper — that is how they read at a glance. */
  td.off { background: #d6d6d6; color: #666; }
  tr.totals td { background: #ececec; font-weight: 700; }
  .note { margin-top: 4mm; border: 0.5pt solid #999; padding: 2mm; font-size: 9pt; min-height: 12mm; }
  .note-label { font-size: 7.5pt; letter-spacing: 1pt; color: #666; margin-bottom: 1mm; }
</style></head>
<body>
  <h1>${escapeHtml(weekTitle(schedule.week_start))}</h1>
  <div class="sub">Emploi du temps du personnel — ${schedule.employees.length} personne${schedule.employees.length > 1 ? 's' : ''} · total ${formatHours(schedule.grand_total_minutes)}</div>
  <table><thead>${header}</thead><tbody>${rows}${totals}</tbody></table>
  ${note}
</body></html>`;
}
