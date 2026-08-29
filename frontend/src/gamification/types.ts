/**
 * Types partagés du système Niveaux + Badges — même forme que les réponses
 * de backend/gamification.py, backend/badges.py, et les points d'écho dans
 * server.py (_public_user, enrich_recipes, GET /auth/me, GET /users/{id}/profile,
 * GET /users/{id}/badges).
 */
export type CompactLevel = {
  level: number;
  title: string;
};

export type LevelDetail = CompactLevel & {
  xp: number;
  xp_into_level: number;
  xp_for_next_level: number | null;
  xp_remaining: number | null;
  next_level_title: string | null;
  current_streak?: number;
  favorite_badge_id?: string | null;
};

export type BadgeCategory = 'boulanger' | 'createur' | 'communaute' | 'social' | 'classement' | 'regularite';

export type BadgeProgress = {
  current: number | null;
  threshold: number | null;
};

export type Badge = {
  id: string;
  name: string;
  description: string | null;
  category: BadgeCategory;
  icon: string;
  rarity: 'commun' | 'rare' | 'epique' | 'legendaire';
  hidden: boolean;
  unlocked_at?: string | null;
  progress?: BadgeProgress;
};

export type GamificationResult = {
  leveled_up: CompactLevel | null;
  badges_unlocked: { id: string; name: string; icon: string }[];
};

/** Une réponse d'action (recette, création, commentaire, ami, collection)
 * qui n'a rien à afficher — jamais un toast vide. */
export function hasGamificationToShow(result?: GamificationResult | null): boolean {
  return !!result && (!!result.leveled_up || result.badges_unlocked.length > 0);
}
