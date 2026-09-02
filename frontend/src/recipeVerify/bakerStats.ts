/**
 * Reflète backend/scan.py côté client, pour recalculer les pourcentages
 * boulanger et l'hydratation sans aller-retour réseau à chaque modification
 * d'un ingrédient sur l'écran de vérification — la même règle des deux
 * côtés : jamais de pourcentage sans farine, jamais une hydratation sans eau
 * ET farine sans ambiguïté (uniquement "eau", jamais un autre liquide en
 * sous-chaîne).
 */
import type { IngredientRow } from './types';

export const FLOUR_MARKER = 'farine';
export const WATER_NAMES = new Set(['eau', 'eau froide', 'eau tiede', 'eau glacee', 'eau chaude']);

export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function toBaseGrams(qty: number, unit: string): number | null {
  if (unit === 'g' || unit === 'ml') return qty;
  if (unit === 'kg' || unit === 'l') return qty * 1000;
  if (unit === 'cl') return qty * 10;
  return null;
}

export function computeBakerStats(rows: IngredientRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const qty = parseFloat(row.quantity.replace(',', '.'));
    if (isNaN(qty) || !row.unit) continue;
    const base = toBaseGrams(qty, row.unit);
    if (base == null) continue;
    const key = normalizeName(row.name);
    totals.set(key, (totals.get(key) || 0) + base);
  }
  let flourTotal = 0, waterTotal = 0;
  for (const [name, qty] of totals) {
    if (name.includes(FLOUR_MARKER)) flourTotal += qty;
    if (WATER_NAMES.has(name)) waterTotal += qty;
  }
  const percentages: Record<string, number> = {};
  if (flourTotal > 0) {
    for (const row of rows) {
      const qty = parseFloat(row.quantity.replace(',', '.'));
      if (isNaN(qty) || !row.unit) continue;
      const base = toBaseGrams(qty, row.unit);
      if (base == null) continue;
      percentages[row.name || '?'] = Math.round((base / flourTotal) * 1000) / 10;
    }
  }
  const hydration = flourTotal > 0 && waterTotal > 0 ? Math.round((waterTotal / flourTotal) * 100) : 0;
  return { percentages: flourTotal > 0 ? percentages : null, hydration };
}

export function ingredientToLine(row: IngredientRow): string {
  const name = row.name.trim();
  const qty = row.quantity.trim();
  const unit = row.unit.trim();
  if (!qty) return name;
  if (!unit) return `${qty} ${name}`;
  return `${qty} ${unit} ${name}`;
}
