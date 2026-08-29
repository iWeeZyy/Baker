"""Adapter une recette : quantité, hydratation, pourcentages, substitution —
fonctions pures, même famille que production.py/costing.py/scan.py.

Aucun second moteur : la grammaire d'ingrédient, les conversions d'unité,
l'arrondi d'affichage et la définition de la farine/de l'eau viennent
toutes de production.py/scan.py, jamais réimplémentées ici. Ce module ne
comble que les deux trous qui manquaient au moteur existant :
  - calculer un facteur d'échelle à partir d'un poids cible (production.py
    ne connaît que "pièces ÷ yield_pieces" pour une planification) ;
  - recalculer des grammes à partir d'un pourcentage boulanger (scan.py ne
    va que dans l'autre sens, grammes -> pourcentages).

Même discipline que le reste du projet : ne jamais deviner. Une opération
qui ne peut pas être honnêtement réalisée (pas de farine, pas d'eau, une
seule farine à répartir, un ingrédient introuvable) renvoie une erreur
explicite plutôt qu'un résultat approximatif.

Précision : chaque fonction publique ci-dessous convertit texte -> état
interne (pleine précision) -> texte en une seule opération, ce qui suffit
pour un appel isolé. `apply_adaptation`, lui, enchaîne plusieurs
opérations : il travaille entièrement sur l'état interne et ne rend le
texte qu'une seule fois, à la toute fin — jamais un arrondi intermédiaire
ré-analysé par l'étape suivante, ce qui accumulerait une dérive à chaque
maillon de la chaîne.
"""
import re
from typing import Dict, List, Optional, Tuple

from production import normalize_name, parse_ingredient, to_base
from scan import bakers_percentages, compute_hydration

_FLOUR_MARKER = "farine"
_WATER_NAMES = {"eau", "eau froide", "eau tiede", "eau glacee", "eau chaude"}

_LEADING_QTY = re.compile(r"^\s*(\d+(?:[.,]\d+)?)")


def _format_value(value: float) -> str:
    """Grammes en entier au-delà de 10 (le cas courant : farine, eau, sucre),
    une décimale en-deçà (la levure, le sel fin peuvent en avoir besoin) —
    jamais une précision uniforme qui perdrait la levure ou afficherait une
    farine à trois décimales."""
    if abs(value) >= 10:
        return str(int(round(value)))
    v = round(value, 1)
    if v == int(v):
        return str(int(v))
    return str(v).replace(".", ",")


def _replace_leading_quantity(line: str, new_value: float) -> str:
    """Ne touche que le nombre en tête de ligne — jamais l'article, jamais
    le nom — même discipline que scaleIngredientLine côté frontend."""
    m = _LEADING_QTY.match(line)
    if not m:
        return line
    return _format_value(new_value) + line[m.end():]


# ---------- État interne (pleine précision) ----------
def _to_state(ingredient_lines: List[str]) -> List[dict]:
    """Une entrée par ligne. Les lignes non parsables sont conservées
    telles quelles (`parsed: False`) plutôt que perdues."""
    state = []
    for i, line in enumerate(ingredient_lines or []):
        parsed = parse_ingredient(line)
        if not parsed:
            state.append({"index": i, "raw": line, "parsed": False})
            continue
        base_qty, base_unit = to_base(parsed["quantity"], parsed["unit"])
        name_norm = normalize_name(parsed["name"])
        state.append({
            "index": i, "raw": line, "parsed": True,
            "name": parsed["name"], "name_norm": name_norm, "unit": parsed["unit"],
            "base_quantity": base_qty, "base_unit": base_unit,
            "is_flour": base_unit in ("g", "ml") and _FLOUR_MARKER in name_norm,
            "is_water": base_unit in ("g", "ml") and name_norm in _WATER_NAMES,
        })
    return state


def _render_state(state: List[dict], original_lines: List[str]) -> List[str]:
    """Texte -> état -> texte : ne reformate que ce qui a réellement changé.
    Une ligne jamais visée garde son texte exact (article, décimales,
    notes) ; une quantité modifiée ne voit remplacer que son nombre en
    tête ; seul un nom substitué est entièrement resynthétisé, faute de
    texte d'origine à préserver pour un ingrédient qui n'existait pas."""
    out = []
    for d in state:
        if not d["parsed"]:
            out.append(d["raw"])
            continue
        orig_line = original_lines[d["index"]]
        orig_parsed = parse_ingredient(orig_line)
        mult = to_base(1.0, d["unit"])[0]
        value = d["base_quantity"] / mult
        if orig_parsed and normalize_name(orig_parsed["name"]) == d["name_norm"]:
            if abs(value - orig_parsed["quantity"]) < 1e-9:
                out.append(orig_line)
            else:
                out.append(_replace_leading_quantity(orig_line, value))
        else:
            out.append(f"{_format_value(value)} {d['unit']} {d['name']}")
    return out


def _flour_total(state: List[dict]) -> float:
    return sum(d["base_quantity"] for d in state if d["parsed"] and d["is_flour"])


def line_details(ingredient_lines: List[str]) -> List[dict]:
    """Chaque ligne, parsée et annotée : farine ? eau ? — pour l'affichage
    (liste des ingrédients à cocher pour une substitution, par exemple)."""
    return _to_state(ingredient_lines)


def total_weight_g(ingredient_lines: List[str]) -> Optional[float]:
    """Somme de tout ingrédient parsable en poids/volume, en grammes (le ml
    compte pour des grammes, densité ~1 — même convention que scan.py pour
    l'hydratation). None si rien n'est parsable, jamais 0 par défaut."""
    state = _to_state(ingredient_lines)
    weighed = [d for d in state if d["parsed"] and d["base_unit"] in ("g", "ml")]
    if not weighed:
        return None
    return sum(d["base_quantity"] for d in weighed)


# ---------- Transformations sur l'état (pleine précision, sans rendu) ----------
def _scale_state(state: List[dict], factor: float) -> List[dict]:
    return [d if not d["parsed"] else {**d, "base_quantity": d["base_quantity"] * factor} for d in state]


def _scale_to_weight_state(state: List[dict], target_weight_g: float) -> Tuple[Optional[List[dict]], Optional[str]]:
    if not target_weight_g or target_weight_g <= 0:
        return None, "Le poids total doit être supérieur à 0."
    current = sum(d["base_quantity"] for d in state if d["parsed"] and d["base_unit"] in ("g", "ml"))
    if current <= 0:
        return None, "Aucun poids total n'a pu être déterminé pour cette recette."
    return _scale_state(state, target_weight_g / current), None


def _scale_to_pieces_and_weight_state(
    state: List[dict], pieces: float, piece_weight_g: float,
) -> Tuple[Optional[List[dict]], Optional[str]]:
    if not pieces or pieces <= 0 or not piece_weight_g or piece_weight_g <= 0:
        return None, "Le nombre de pièces et le poids par pièce doivent être supérieurs à 0."
    return _scale_to_weight_state(state, pieces * piece_weight_g)


def _set_hydration_state(state: List[dict], target_hydration_pct: float) -> Tuple[Optional[List[dict]], Optional[str]]:
    if target_hydration_pct is None or target_hydration_pct < 0:
        return None, "L'hydratation doit être un pourcentage positif."
    flour_total = _flour_total(state)
    if flour_total <= 0:
        return None, "Aucune farine identifiable : impossible de calculer l'hydratation."
    water = [d for d in state if d["parsed"] and d["is_water"]]
    water_total = sum(d["base_quantity"] for d in water)
    if not water or water_total <= 0:
        return None, "Aucune eau identifiable dans cette recette : impossible d'ajuster l'hydratation."

    target_water_total = target_hydration_pct / 100.0 * flour_total
    out = list(state)
    for d in water:
        share = d["base_quantity"] / water_total
        out[d["index"]] = {**d, "base_quantity": target_water_total * share}
    return out, None


def _set_flour_mix_state(state: List[dict], changes: Dict[str, float]) -> Tuple[Optional[List[dict]], Optional[str]]:
    if not changes:
        return list(state), None
    flour_lines = [d for d in state if d["parsed"] and d["is_flour"]]
    if len(flour_lines) < 2:
        return None, "Cette recette n'a qu'une seule farine : rien à répartir."
    flour_total = sum(d["base_quantity"] for d in flour_lines)
    if flour_total <= 0:
        return None, "Aucune farine identifiable dans cette recette."

    normalized_changes = {normalize_name(k): v for k, v in changes.items()}
    matched: Dict[int, float] = {}
    matched_names = set()
    for d in flour_lines:
        if d["name_norm"] in normalized_changes:
            matched[d["index"]] = normalized_changes[d["name_norm"]]
            matched_names.add(d["name_norm"])
    unmatched_names = set(normalized_changes) - matched_names
    if unmatched_names:
        return None, f"Farine introuvable : {', '.join(sorted(unmatched_names))}"
    if any(p < 0 for p in matched.values()):
        return None, "Un pourcentage de farine ne peut pas être négatif."
    explicit_pct_sum = sum(matched.values())
    if explicit_pct_sum > 100 + 1e-6:
        return None, "Les pourcentages de farine dépassent 100 %."

    remaining_pct = 100.0 - explicit_pct_sum
    other_lines = [d for d in flour_lines if d["index"] not in matched]
    other_current_total = sum(d["base_quantity"] for d in other_lines)

    out = list(state)
    for d in flour_lines:
        if d["index"] in matched:
            new_base = matched[d["index"]] / 100.0 * flour_total
        elif other_current_total > 0:
            new_base = remaining_pct / 100.0 * flour_total * (d["base_quantity"] / other_current_total)
        else:
            # Les farines non mentionnées pesaient déjà 0 (cas limite) :
            # partage égal plutôt qu'une division par zéro.
            new_base = remaining_pct / 100.0 * flour_total / len(other_lines)
        out[d["index"]] = {**d, "base_quantity": new_base}
    return out, None


def _set_ingredient_pct_state(state: List[dict], changes: Dict[str, float]) -> Tuple[Optional[List[dict]], Optional[str]]:
    if not changes:
        return list(state), None
    flour_total = _flour_total(state)
    if flour_total <= 0:
        return None, "Aucune farine identifiable : impossible de calculer un pourcentage boulanger."

    by_name: Dict[str, dict] = {}
    for d in state:
        if d["parsed"] and not d["is_flour"]:
            by_name.setdefault(d["name_norm"], d)

    normalized_changes = {normalize_name(k): v for k, v in changes.items()}
    unmatched = []
    out = list(state)
    for name_norm, pct in normalized_changes.items():
        d = by_name.get(name_norm)
        if not d:
            unmatched.append(name_norm)
            continue
        if pct < 0:
            return None, f"Le pourcentage de {d['name']} ne peut pas être négatif."
        out[d["index"]] = {**d, "base_quantity": pct / 100.0 * flour_total}
    if unmatched:
        return None, f"Ingrédient introuvable : {', '.join(sorted(unmatched))}"
    return out, None


def _substitute_state(state: List[dict], substitutions: List[dict]) -> Tuple[Optional[List[dict]], Optional[str]]:
    if not substitutions:
        return list(state), None
    by_name = {d["name_norm"]: d for d in state if d["parsed"]}
    out = list(state)
    unmatched = []
    for sub in substitutions:
        key = normalize_name(sub.get("from_name") or "")
        d = by_name.get(key)
        if not d:
            unmatched.append(sub.get("from_name") or "?")
            continue
        to_name = sub.get("to_name") or d["name"]
        new_qty = sub.get("new_quantity")
        if new_qty is not None:
            new_unit = sub.get("new_unit") or d["unit"]
            base_qty, base_unit = to_base(float(new_qty), new_unit)
            out[d["index"]] = {
                **d, "name": to_name, "name_norm": normalize_name(to_name),
                "unit": new_unit, "base_quantity": base_qty, "base_unit": base_unit,
                "is_flour": False, "is_water": False,
            }
        else:
            # Pas de quantité fournie : conservée telle quelle — ne jamais
            # supposer une équivalence entre deux ingrédients.
            out[d["index"]] = {**d, "name": to_name, "name_norm": normalize_name(to_name), "is_flour": False, "is_water": False}
    if unmatched:
        return None, f"Ingrédient à remplacer introuvable : {', '.join(unmatched)}"
    return out, None


# ---------- API publique : texte -> texte, un seul passage ----------
def scale_to_weight(ingredient_lines: List[str], target_weight_g: float) -> Tuple[Optional[List[str]], Optional[str]]:
    state, err = _scale_to_weight_state(_to_state(ingredient_lines), target_weight_g)
    return (None, err) if err else (_render_state(state, ingredient_lines), None)


def scale_to_pieces_and_weight(
    ingredient_lines: List[str], pieces: float, piece_weight_g: float,
) -> Tuple[Optional[List[str]], Optional[str]]:
    state, err = _scale_to_pieces_and_weight_state(_to_state(ingredient_lines), pieces, piece_weight_g)
    return (None, err) if err else (_render_state(state, ingredient_lines), None)


def set_hydration(ingredient_lines: List[str], target_hydration_pct: float) -> Tuple[Optional[List[str]], Optional[str]]:
    state, err = _set_hydration_state(_to_state(ingredient_lines), target_hydration_pct)
    return (None, err) if err else (_render_state(state, ingredient_lines), None)


def set_flour_mix_percentages(
    ingredient_lines: List[str], changes: Dict[str, float],
) -> Tuple[Optional[List[str]], Optional[str]]:
    state, err = _set_flour_mix_state(_to_state(ingredient_lines), changes)
    return (None, err) if err else (_render_state(state, ingredient_lines), None)


def set_ingredient_percentages(
    ingredient_lines: List[str], changes: Dict[str, float],
) -> Tuple[Optional[List[str]], Optional[str]]:
    state, err = _set_ingredient_pct_state(_to_state(ingredient_lines), changes)
    return (None, err) if err else (_render_state(state, ingredient_lines), None)


def substitute_ingredients(
    ingredient_lines: List[str], substitutions: List[dict],
) -> Tuple[Optional[List[str]], Optional[str]]:
    state, err = _substitute_state(_to_state(ingredient_lines), substitutions)
    return (None, err) if err else (_render_state(state, ingredient_lines), None)


# ---------- Orchestrateur ----------
def apply_adaptation(
    ingredient_lines: List[str], request: Optional[dict], original_yield_pieces: Optional[int] = None,
) -> dict:
    """Enchaîne, dans un ordre fixe et documenté, les étapes présentes dans
    la requête :
    1) mise à l'échelle quantité/poids (transforme tout, y compris la
       farine totale de référence pour les étapes suivantes) ;
    2) répartition farine/farine ;
    3) hydratation ;
    4) pourcentages non-farine ;
    5) substitutions (en dernier, reprenant par défaut la quantité déjà
       recalculée par les étapes précédentes, jamais l'originale).
    Tout se passe sur l'état interne (décision de précision, voir
    docstring du module) — le texte n'est produit qu'à la toute fin.
    À la moindre erreur bloquante, le pipeline s'arrête et renvoie
    `ok: False` — jamais un résultat partiellement appliqué.
    """
    request = request or {}
    errors: List[str] = []
    state = _to_state(ingredient_lines)

    def _run(step_state, err):
        """Applique le résultat d'une étape si elle a réussi, journalise
        l'erreur sinon — évite de répéter ce if/else à chaque étape."""
        if err:
            errors.append(err)
            return state
        return step_state

    target_total = request.get("target_total_weight_g")
    target_pieces = request.get("target_yield_pieces")
    target_piece_weight = request.get("target_piece_weight_g")
    if target_pieces and target_piece_weight:
        state = _run(*_scale_to_pieces_and_weight_state(state, target_pieces, target_piece_weight))
    elif target_total:
        state = _run(*_scale_to_weight_state(state, target_total))
    elif target_pieces or target_piece_weight:
        errors.append("Il faut indiquer à la fois le nombre de pièces et le poids par pièce, ou directement un poids total.")

    if not errors:
        flour_changes = request.get("flour_percentage_changes") or {}
        if flour_changes:
            state = _run(*_set_flour_mix_state(state, flour_changes))

    if not errors:
        hydration = request.get("target_hydration_pct")
        if hydration is not None:
            state = _run(*_set_hydration_state(state, hydration))

    if not errors:
        ing_changes = request.get("ingredient_percentage_changes") or {}
        if ing_changes:
            state = _run(*_set_ingredient_pct_state(state, ing_changes))

    if not errors:
        subs = request.get("substitutions") or []
        if subs:
            state = _run(*_substitute_state(state, subs))

    if errors:
        return {"ok": False, "errors": errors, "warnings": []}

    final_lines = _render_state(state, ingredient_lines)

    # Recalcul final par le même moteur que le reste de l'app (scan.py) —
    # jamais reporté à la main d'une étape à l'autre.
    percentages = bakers_percentages(final_lines) or {}
    hydration_result = compute_hydration(final_lines)
    total = total_weight_g(final_lines)

    ingredients = []
    for d, final_line, orig_line in zip(state, final_lines, ingredient_lines):
        if not d["parsed"]:
            ingredients.append({"index": d["index"], "raw": final_line, "parsed": False, "changed": final_line != orig_line})
            continue
        parsed_final = parse_ingredient(final_line)
        ingredients.append({
            "index": d["index"], "raw": final_line, "parsed": True,
            "name": parsed_final["name"], "quantity": parsed_final["quantity"], "unit": parsed_final["unit"],
            "percentage": percentages.get(parsed_final["name"]),
            "is_flour": d["is_flour"], "is_water": d["is_water"],
            "changed": final_line != orig_line,
        })

    new_yield_pieces = target_pieces if (target_pieces and target_piece_weight) else original_yield_pieces
    piece_weight_g = round(total / new_yield_pieces, 1) if (new_yield_pieces and total) else None

    return {
        "ok": True,
        "errors": [],
        "warnings": [],
        "ingredients": ingredients,
        "yield_pieces": new_yield_pieces,
        "piece_weight_g": piece_weight_g,
        "total_weight_g": round(total, 1) if total else None,
        "hydration": hydration_result,
    }
