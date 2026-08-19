/**
 * Le calculateur de coût de revient : mêmes formules que `backend/costing.py`,
 * portées côté client pour un recalcul instantané pendant la saisie (prix
 * matière simulé, emballage, prix de vente, TVA…), sur le même principe que
 * `ingredientScale.ts`/`production.py` — deux implémentations jumelles plutôt
 * qu'un aller-retour réseau à chaque frappe.
 *
 * Trois règles, reprises telles quelles du serveur :
 *   - Jamais 0 € pour un ingrédient sans prix connu — `price_missing` bloque
 *     le total plutôt que de le sous-évaluer en silence.
 *   - Jamais de quantité devinée — une ligne sans nombre en tête est exclue
 *     du total et signalée, pas comptée pour 0.
 *   - Précision pleine en interne ; seul l'affichage arrondit.
 */

// ---------- Analyse d'une ligne d'ingrédient (miroir de production.py) ----------
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const INGREDIENT = new RegExp(`^\\s*(${NUM})\\s*(kg|g|cl|ml|l)\\b\\s*(?:de\\s+|d['’]\\s*)?(.+?)\\s*$`, 'i');
// Un compte sans unité explicite : "3 œufs", "2 pommes" — tenté seulement
// après l'échec du motif ci-dessus, donc "500 g de farine" n'est jamais
// relu comme "500 pièces de g de farine".
const BARE_COUNT = new RegExp(`^\\s*(${NUM})\\s+(?:de\\s+|d['’]\\s*)?(.+?)\\s*$`, 'i');

const UNIT_BASE: Record<string, [string, number]> = {
  g: ['g', 1],
  kg: ['g', 1000],
  ml: ['ml', 1],
  cl: ['ml', 10],
  l: ['ml', 1000],
};

/** Clé de regroupement d'un nom d'ingrédient — identique à `normalize_name` côté serveur. */
export function normalizeName(name: string): string {
  const n = (name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  return n.replace(/^[\s.,;:]+|[\s.,;:]+$/g, '');
}

export type ParsedQuantity = { quantity: number; unit: string; name: string; kind: 'weight' | 'volume' | 'piece' };

/** `"500 g de farine T65"` -> quantité/unité/nom en unité de base (g ou ml), ou compte à la pièce. */
export function parseIngredientForCosting(line: string): ParsedQuantity | null {
  if (!line) return null;
  const m = line.match(INGREDIENT);
  if (m) {
    const [, rawQty, unit, name] = m;
    const [baseUnit, mult] = UNIT_BASE[unit.toLowerCase()];
    const qty = parseFloat(rawQty.replace(',', '.'));
    return { quantity: qty * mult, unit: baseUnit, name: name.trim(), kind: baseUnit === 'g' ? 'weight' : 'volume' };
  }
  const bare = line.match(BARE_COUNT);
  if (!bare) return null;
  const qty = parseFloat(bare[1].replace(',', '.'));
  if (!Number.isFinite(qty)) return null;
  return { quantity: qty, unit: 'piece', name: bare[2].trim(), kind: 'piece' };
}

// ---------- Matières premières ----------
export type RawMaterial = {
  id: string;
  name: string;
  normalized_name: string;
  category?: string | null;
  supplier?: string | null;
  purchase_price: number;
  purchase_quantity: number;
  purchase_unit: string;
  price_per_kg: number | null;
  price_per_l: number | null;
  price_per_piece: number | null;
  updated_at?: string;
};

export type CostLineStatus = 'ok' | 'price_missing' | 'unparsed';

export type CostLine = {
  raw: string;
  status: CostLineStatus;
  name?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  cost?: number;
  rawMaterialId?: string | null;
};

export function priceLookup(materials: RawMaterial[]): Record<string, RawMaterial> {
  const out: Record<string, RawMaterial> = {};
  for (const m of materials) out[m.normalized_name] = m;
  return out;
}

/** Le prix d'un ingrédient : la simulation (`overrides`) prime sur le prix enregistré. */
export function costLine(line: string, prices: Record<string, RawMaterial>, overrides?: Record<string, number>): CostLine {
  const parsed = parseIngredientForCosting(line);
  if (!parsed) return { raw: line, status: 'unparsed' };

  const key = normalizeName(parsed.name);
  const override = overrides?.[key];
  const rm = prices[key];
  const stored = rm ? { weight: rm.price_per_kg, volume: rm.price_per_l, piece: rm.price_per_piece }[parsed.kind] : null;
  const unitPrice = override ?? stored ?? null;

  if (unitPrice == null) {
    return {
      raw: line, status: 'price_missing', name: parsed.name,
      quantity: parsed.quantity, unit: parsed.unit, rawMaterialId: rm?.id ?? null,
    };
  }
  const divisor = parsed.kind === 'piece' ? 1 : 1000;
  const cost = (parsed.quantity / divisor) * unitPrice;
  return {
    raw: line, status: 'ok', name: parsed.name,
    quantity: parsed.quantity, unit: parsed.unit, unitPrice, cost,
    rawMaterialId: rm?.id ?? null,
  };
}

export type CostLineItem = { label: string; cost: number };

export type RecipeCostResult = {
  items: CostLine[];
  hasMissingPrices: boolean;
  missingCount: number;
  unparsedCount: number;
  rawMaterialsCost: number | null;
  packagingCost: number;
  otherCost: number;
  totalCost: number | null;
  pieces: number | null;
  costPerPiece: number | null;
};

export function computeRecipeCost(
  ingredientLines: string[],
  materials: RawMaterial[],
  packaging: CostLineItem[],
  otherCosts: CostLineItem[],
  pieces: number | null,
  overrides?: Record<string, number>,
): RecipeCostResult {
  const prices = priceLookup(materials);
  const items = (ingredientLines || []).map(line => costLine(line, prices, overrides));
  const missing = items.filter(i => i.status === 'price_missing');
  const unparsed = items.filter(i => i.status === 'unparsed');
  const ok = items.filter(i => i.status === 'ok');

  const rawMaterialsCost = missing.length ? null : ok.reduce((s, i) => s + (i.cost || 0), 0);
  const packagingCost = (packaging || []).reduce((s, p) => s + (p.cost || 0), 0);
  const otherCost = (otherCosts || []).reduce((s, o) => s + (o.cost || 0), 0);
  const totalCost = rawMaterialsCost === null ? null : rawMaterialsCost + packagingCost + otherCost;
  const costPerPiece = totalCost !== null && pieces && pieces > 0 ? totalCost / pieces : null;

  return {
    items,
    hasMissingPrices: missing.length > 0,
    missingCount: missing.length,
    unparsedCount: unparsed.length,
    rawMaterialsCost,
    packagingCost,
    otherCost,
    totalCost,
    pieces,
    costPerPiece,
  };
}

export type SaleMetrics = {
  salePriceHt: number | null;
  vatRate: number | null;
  salePriceTtc: number | null;
  revenueHt: number | null;
  marginPerPiece: number | null;
  marginTotal: number | null;
  marginRatePct: number | null;
  markupRatePct: number | null;
};

/**
 * Taux de marge = (PV HT - coût) / coût x 100 ; taux de marque = (PV HT - coût) / PV HT x 100.
 * La marge se calcule sur le prix HT : la TVA est collectée pour l'État, pas
 * un revenu du boulanger. `vatRate` n'est jamais supposé — sans valeur
 * choisie, le TTC reste indéfini plutôt que de sous-entendre 0 %.
 */
export function computeSaleMetrics(
  costPerPiece: number | null,
  pieces: number | null,
  salePriceHt: number | null,
  vatRate: number | null,
): SaleMetrics {
  const result: SaleMetrics = {
    salePriceHt, vatRate, salePriceTtc: null, revenueHt: null,
    marginPerPiece: null, marginTotal: null, marginRatePct: null, markupRatePct: null,
  };
  if (salePriceHt != null && vatRate != null) {
    result.salePriceTtc = salePriceHt * (1 + vatRate / 100);
  }
  if (salePriceHt == null || costPerPiece == null) return result;

  const margin = salePriceHt - costPerPiece;
  result.marginPerPiece = margin;
  if (pieces && pieces > 0) {
    result.marginTotal = margin * pieces;
    result.revenueHt = salePriceHt * pieces;
  }
  if (costPerPiece > 0) result.marginRatePct = (margin / costPerPiece) * 100;
  if (salePriceHt > 0) result.markupRatePct = (margin / salePriceHt) * 100;
  return result;
}

// ---------- Formatage (affichage uniquement — jamais réinjecté dans un calcul) ----------
export function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Un prix unitaire précis (jusqu'à 3 décimales), pour ne pas perdre 1,25 g à l'affichage. */
export function formatCurrencyPrecise(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 1000) / 1000;
  return `${rounded.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} €`;
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}
