/**
 * Instantané "production du jour" partagé avec le widget iOS (WidgetKit),
 * via l'App Group `group.com.lucasmorey.levanea` et le module `ExtensionStorage`
 * fourni par `@bacons/apple-targets`. Aucune donnée parallèle : ce fichier ne
 * fait que relire les mêmes routes et appliquer les mêmes règles d'heure et
 * de quantité que `app/production/[id].tsx`, jamais un calcul inventé.
 *
 * L'heure retenue par ligne est celle de sa première étape connue (même
 * logique d'ancrage que `production/[id].tsx`) — jamais devinée : une ligne
 * dont aucune étape n'a d'horaire reste sans heure plutôt que d'en afficher
 * une fausse.
 */
import { Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { api } from './api';

const APP_GROUP = 'group.com.lucasmorey.levanea';
const STORAGE_KEY = 'widgetData';

export type WidgetProductionItem = {
  line_id: string;
  recipe_title: string;
  time: string | null;
  quantity_label: string;
  all_done: boolean;
};

export type WidgetSnapshot = {
  logged_in: boolean;
  user_id?: string;
  date?: string;
  production_id?: string;
  items?: WidgetProductionItem[];
};

type WidgetLine = {
  line_id: string;
  recipe_title: string;
  mode: 'pieces' | 'batches';
  quantity: number;
  yield_pieces: number | null;
  batches: number;
};

type WidgetStep = {
  line_id: string;
  status: 'todo' | 'doing' | 'done';
  start_at: string | null;
  end_at: string | null;
};

type WidgetProductionDetail = {
  id: string;
  date: string;
  lines: WidgetLine[];
  steps: WidgetStep[];
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Même format que `formatDecimal` dans production/[id].tsx : deux décimales, virgule française. */
function formatDecimal(n: number): string {
  return String(Number(n.toFixed(2))).replace('.', ',');
}

/** Même règle d'affichage que production/[id].tsx : jamais un nombre de pièces inventé quand `yield_pieces` est absent. */
function quantityLabel(line: WidgetLine): string {
  if (line.mode === 'pieces') return `${line.quantity} pièce${line.quantity > 1 ? 's' : ''}`;
  if (line.yield_pieces) return `${Math.round(line.batches * line.yield_pieces)} pièces`;
  return `${formatDecimal(line.batches)} fournée${line.batches > 1 ? 's' : ''}`;
}

/**
 * Pure — construit exactement le JSON envoyé au widget à partir du détail
 * d'une production, sans jamais rien deviner. `userId` est un garde-fou
 * défensif que le widget revérifie de son côté avant d'afficher quoi que ce
 * soit, en plus de la remise à zéro faite à la déconnexion.
 */
export function buildWidgetSnapshot(userId: string, production: WidgetProductionDetail | null): WidgetSnapshot {
  if (!production) return { logged_in: true, user_id: userId, date: todayISO(), items: [] };

  // Horodatage connu le plus tôt par ligne — même logique d'ancrage que
  // production/[id].tsx, pour que le widget ne montre jamais une heure que
  // la fiche production elle-même ne dériverait pas.
  const anchors = new Map<string, string>();
  const stepsByLine = new Map<string, WidgetStep[]>();
  for (const s of production.steps) {
    const arr = stepsByLine.get(s.line_id) || [];
    arr.push(s);
    stepsByLine.set(s.line_id, arr);

    const t = s.start_at || s.end_at;
    if (!t) continue;
    const current = anchors.get(s.line_id);
    if (!current || t < current) anchors.set(s.line_id, t);
  }

  const items: WidgetProductionItem[] = production.lines
    .map((line) => {
      const anchor = anchors.get(line.line_id) || null;
      const steps = stepsByLine.get(line.line_id) || [];
      return {
        line_id: line.line_id,
        recipe_title: line.recipe_title,
        time: anchor ? clock(anchor) : null,
        quantity_label: quantityLabel(line),
        all_done: steps.length > 0 && steps.every((s) => s.status === 'done'),
      };
    })
    .sort((a, b) => {
      if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
      if (a.time) return -1;
      if (b.time) return 1;
      return 0;
    });

  return { logged_in: true, user_id: userId, date: production.date, production_id: production.id, items };
}

let storage: ExtensionStorage | null = null;
function getStorage(): ExtensionStorage | null {
  // Le module natif n'existe que sur iOS (aucun équivalent Android construit
  // pour ce projet) : partout ailleurs, un no-op silencieux.
  if (Platform.OS !== 'ios') return null;
  if (!storage) storage = new ExtensionStorage(APP_GROUP);
  return storage;
}

function writeSnapshot(snapshot: WidgetSnapshot) {
  const s = getStorage();
  if (!s) return;
  // Une chaîne JSON, pas un objet imbriqué : ExtensionStorage.set() n'est
  // typé que pour string/number/dictionnaire plat côté JS, et une chaîne
  // laisse le décodage Swift entièrement déterministe côté widget.
  s.set(STORAGE_KEY, JSON.stringify(snapshot));
  ExtensionStorage.reloadWidget();
}

/**
 * Recalcule et republie l'instantané du jour pour le widget. Best-effort et
 * silencieux : un échec réseau ne doit jamais remonter à l'écran — le widget
 * garde simplement son dernier instantané valable.
 */
export async function syncWidgetData(userId: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const today = todayISO();
    const list: { id: string }[] = await api(`/productions?date_from=${today}&date_to=${today}`);
    const productionId = list[0]?.id;
    const detail: WidgetProductionDetail | null = productionId ? await api(`/productions/${productionId}`) : null;
    writeSnapshot(buildWidgetSnapshot(userId, detail));
  } catch {
    // Cf. docstring : silencieux par conception.
  }
}

/**
 * Appelé à la déconnexion, avant même que l'app n'oublie son propre token :
 * efface toute trace du compte pour qu'aucune donnée ne survive au compte
 * suivant qui se connecte sur le même appareil.
 */
export function clearWidgetData(): void {
  if (Platform.OS !== 'ios') return;
  try {
    writeSnapshot({ logged_in: false });
  } catch {
    // Silencieux : une déconnexion ne doit jamais échouer à cause du widget.
  }
}
