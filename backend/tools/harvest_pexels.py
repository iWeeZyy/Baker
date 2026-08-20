"""Moissonne une photo par recette sur Pexels, pour relecture à l'œil.

Cet outil ne décide de rien. Il prépare le travail de relecture : il interroge
Pexels, télécharge les vignettes des candidats et les assemble en une
**planche-contact** par recette. C'est un humain — ou un modèle qui regarde
vraiment l'image — qui choisit ensuite, et qui écrit dans `recipe_photos.py`
*ce qu'il a vu*.

Pourquoi une planche plutôt qu'un choix automatique
---------------------------------------------------
Parce que le premier résultat d'une banque d'images n'est pas fiable, et que la
faute ne se voit pas dans le texte. Éprouvé sur ce projet lors d'une première
tentative via Wikimedia Commons : une recherche « croissant » rendait un
**oranais**, une recherche « bretzel » un **sandwich de chaîne sur un plateau de
cafétéria**. Les deux avaient un titre parfait. Aucun score textuel ne les
écarte ; seul le regard le fait.

Utilisation
-----------
    export PEXELS_API_KEY=…              # https://www.pexels.com/api/
    python3 tools/harvest_pexels.py planches/          # toutes les recettes
    python3 tools/harvest_pexels.py planches/ Croissants "Pain de campagne"

Chaque planche est écrite dans le dossier donné, et chaque candidat est consigné
au fil de l'eau dans `<dossier>/journal.json` : la moisson des 194 recettes est
longue, et sans ce vidage une interruption ferait tout recommencer.

Quotas
------
Pexels autorise 200 requêtes par heure. Une recherche rend jusqu'à 80 résultats
d'un coup, donc **un appel suffit par recette** : les 194 tiennent en deux
heures avec la marge de sécurité de `PAUSE`. Les vignettes viennent du CDN, qui
ne compte pas dans ce quota.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seed_data import RECIPES_SEED  # noqa: E402

API = "https://api.pexels.com/v1/search"
PER_PAGE = 15          # quinze candidats en un appel : de quoi juger sans noyer
PAUSE = 2.0            # entre deux appels, très en dessous des 200/heure
RETRIES = 4
MIN_WIDTH = 1200       # en dessous, la photo pixellise sur le bandeau de la fiche

# Vignettes de la planche.
THUMB_KEY = "medium"   # ~350 px : assez pour reconnaître un produit
COLS = 5
CELL = 300
LABEL = 30


def _key() -> str:
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not key:
        sys.exit(
            "PEXELS_API_KEY absente.\n"
            "  1. créer une clé sur https://www.pexels.com/api/ (gratuite)\n"
            "  2. export PEXELS_API_KEY=…\n"
            "Rappel : api.pexels.com et images.pexels.com doivent aussi être\n"
            "autorisés par la politique réseau de l'environnement."
        )
    return key


def _get(url: str, headers: dict, binary: bool = False):
    """GET avec reprise sur 429 et 5xx. Renvoie (code, corps) ou (code, None)."""
    for attempt in range(RETRIES):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read()
                return r.status, body if binary else body.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 403:
                # Refus de la politique réseau, pas de la banque : réessayer ne
                # sert à rien et le README du proxy demande de le signaler.
                sys.exit(f"403 sur {urllib.parse.urlparse(url).netloc} — hôte refusé "
                         f"par la politique réseau de l'environnement. À ouvrir avant "
                         f"de relancer.")
            if e.code in (429, 500, 502, 503) and attempt < RETRIES - 1:
                wait = PAUSE * (2 ** attempt)
                print(f"      {e.code}, pause {wait:.0f} s…", file=sys.stderr)
                time.sleep(wait)
                continue
            return e.code, None
        except urllib.error.URLError as exc:
            # Un refus de la politique réseau arrive ici, pas en HTTPError : le
            # proxy répond 403 au CONNECT, donc avant toute réponse HTTP. Le
            # distinguer d'une panne réseau est ce qui évite quatre reprises
            # inutiles suivies d'un journal de 194 entrées vides.
            if "403" in str(exc.reason) and "unnel" in str(exc.reason):
                sys.exit(
                    f"\n403 au CONNECT sur {urllib.parse.urlparse(url).netloc} — "
                    f"l'hôte est refusé par la politique réseau de\n"
                    f"l'environnement, et aucune reprise n'y changera rien.\n"
                    f"Ouvrir api.pexels.com et images.pexels.com, puis relancer.\n"
                    f"  cf. https://code.claude.com/docs/en/claude-code-on-the-web"
                )
            if attempt < RETRIES - 1:
                time.sleep(PAUSE)
                continue
            print(f"      erreur réseau : {exc}", file=sys.stderr)
            return 0, None
        except Exception as exc:
            if attempt < RETRIES - 1:
                time.sleep(PAUSE)
                continue
            print(f"      erreur réseau : {exc}", file=sys.stderr)
            return 0, None
    return 0, None


def queries_for(recipe: dict) -> list:
    """Les requêtes à essayer pour une recette, de la plus précise à la plus large.

    Le titre d'abord, tel quel : c'est lui qui porte les caractéristiques du
    produit (« pain aux noix » et non « pain »). La catégorie ensuite, comme
    filet de sécurité, mais elle ne donne que des candidats génériques — ce que
    la relecture devra sanctionner plutôt qu'accepter par lassitude.
    """
    title = recipe["title"]
    out = [title]
    bare = title.split(" à ")[0].split(",")[0].split(" et ")[0].strip()
    if bare and bare != title:
        out.append(bare)
    return out


def search(query: str, key: str) -> list:
    """Les candidats Pexels pour une requête, réduits à ce dont on a besoin."""
    url = (f"{API}?query={urllib.parse.quote(query)}"
           f"&per_page={PER_PAGE}&orientation=landscape&locale=fr-FR")
    code, body = _get(url, {"Authorization": key})
    if code != 200 or not body:
        print(f"      recherche « {query} » : {code}", file=sys.stderr)
        return []
    try:
        photos = json.loads(body).get("photos", [])
    except json.JSONDecodeError:
        return []
    out = []
    for p in photos:
        if p.get("width", 0) < MIN_WIDTH:
            continue          # trop petite pour le bandeau de la fiche
        out.append({
            "id": p["id"],
            "url": p["src"]["large2x"],
            "thumb": p["src"][THUMB_KEY],
            "page": p["url"],
            "author": p.get("photographer") or "",
            "author_url": p.get("photographer_url") or "",
            "alt": (p.get("alt") or "").strip(),
            "width": p.get("width"),
            "height": p.get("height"),
            "source": "pexels",
            "licence": "Pexels License",
        })
    return out


def contact_sheet(title: str, candidates: list, out_png: Path, key: str) -> int:
    """Assemble les candidats en une planche numérotée. Renvoie le nombre posé."""
    from PIL import Image, ImageDraw   # importé ici : inutile sans moisson
    import io

    tiles = []
    for c in candidates:
        code, body = _get(c["thumb"], {"Authorization": key}, binary=True)
        if code != 200 or not body:
            continue
        try:
            tiles.append((c, Image.open(io.BytesIO(body)).convert("RGB")))
        except Exception:
            continue
        time.sleep(0.2)

    if not tiles:
        return 0

    rows = (len(tiles) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (c, im) in enumerate(tiles):
        im.thumbnail((CELL - 8, CELL - LABEL - 8))
        x, y = (i % COLS) * CELL, (i // COLS) * (CELL + LABEL)
        sheet.paste(im, (x + (CELL - im.width) // 2, y + LABEL + (CELL - LABEL - im.height) // 2))
        draw.rectangle([x, y, x + CELL - 1, y + LABEL - 1], fill="#2a1f1a")
        draw.text((x + 6, y + 9), f"{i + 1}. {c['alt'][:38] or c['id']}", fill="white")
        draw.rectangle([x, y, x + CELL - 1, y + CELL + LABEL - 1], outline="#ddd")
    out_png.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_png, quality=88)
    return len(tiles)


def main() -> None:
    key = _key()
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("planches")
    wanted = set(sys.argv[2:])
    recipes = [r for r in RECIPES_SEED if not wanted or r["title"] in wanted]
    if wanted:
        missing = sorted(wanted - {r["title"] for r in recipes})
        if missing:
            sys.exit(f"titres inconnus du catalogue : {', '.join(missing)}")

    journal_path = dest / "journal.json"
    journal = {}
    if journal_path.exists():
        journal = json.loads(journal_path.read_text(encoding="utf-8"))

    for n, recipe in enumerate(recipes, 1):
        title = recipe["title"]
        # On ne saute que ce qui a réellement rendu des candidats : une entrée
        # vide vient d'une panne ou d'une requête trop étroite, et doit être
        # retentée, pas figée par la reprise.
        if journal.get(title, {}).get("candidats"):
            continue
        print(f"[{n}/{len(recipes)}] {title}")
        candidates = []
        for query in queries_for(recipe):
            candidates = search(query, key)
            time.sleep(PAUSE)
            if candidates:
                print(f"      « {query} » → {len(candidates)} candidats")
                break
            print(f"      « {query} » → rien, on élargit")

        slug = "".join(ch if ch.isalnum() else "_" for ch in title)[:48]
        png = dest / f"{slug}.png"
        posed = contact_sheet(title, candidates, png, key) if candidates else 0
        journal[title] = {
            "famille": recipe.get("family"),
            "categorie": recipe.get("category"),
            "planche": str(png) if posed else None,
            "candidats": candidates,
            # Rempli à la relecture, pas ici : l'outil ne choisit pas.
            "retenu": None,
            "score": None,
            "vu": None,
        }
        journal_path.parent.mkdir(parents=True, exist_ok=True)
        journal_path.write_text(json.dumps(journal, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"      planche : {png if posed else '— aucune'}")

    print(f"\n{len(journal)} recettes moissonnées → {journal_path}")
    print("Relire les planches, puis reporter les choix dans backend/recipe_photos.py.")


if __name__ == "__main__":
    main()
