# Levanea

Application mobile (iOS/Android/Web) dédiée aux boulangers : recettes classiques françaises, astuces techniques, assistant IA, partage communautaire. Frontend Expo/React Native, backend FastAPI + MongoDB.

## Architecture

```
backend/    FastAPI + MongoDB (Motor), JWT auth, assistant IA (Anthropic), stockage photos local
frontend/   Expo Router (React Native), TypeScript
```

Ce projet ne dépend plus d'aucun service tiers "Emergent" : l'authentification est email/mot de passe uniquement, les photos sont stockées sur disque côté serveur, et l'assistant IA appelle directement l'API Anthropic avec ta propre clé.

## Lancer le projet en local

### 1. Backend

Prérequis : Python 3.11+, une instance MongoDB (locale via Docker, ou un cluster gratuit MongoDB Atlas).

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# MongoDB local (si tu n'as pas Atlas) :
docker run -d -p 27017:27017 --name levanea-mongo mongo:7

cp .env.example .env   # puis édite JWT_SECRET et ANTHROPIC_API_KEY
uvicorn server:app --reload --port 8000
```

Variables d'environnement (`backend/.env`) :

| Variable | Description |
|---|---|
| `MONGO_URL` | URL de connexion MongoDB |
| `DB_NAME` | Nom de la base |
| `JWT_SECRET` | Secret de signature des tokens — génère le tien avec `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `ANTHROPIC_API_KEY` | Clé API Anthropic (console.anthropic.com) — sans elle, `/api/chat` répond 503 |
| `CORS_ORIGINS` | Origines autorisées, séparées par des virgules (`*` en dev) |

### 2. Frontend

```bash
cd frontend
yarn install
cp .env.example .env   # EXPO_PUBLIC_BACKEND_URL doit pointer vers ton backend
npx expo start
```

Sur un appareil physique, `localhost` ne fonctionne pas : mets l'IP locale de ta machine (`http://192.168.x.x:8000`) dans `EXPO_PUBLIC_BACKEND_URL`.

## Utiliser l'app depuis ton iPhone sans PC (gratuit)

TestFlight nécessite un compte Apple Developer payant (99 $/an) — impossible à contourner. En attendant, cette option déploie le backend et une version web de l'app dans le cloud (gratuit, ton PC n'a plus besoin de tourner ensuite) : tu ouvres simplement l'URL dans Safari sur ton iPhone et tu l'ajoutes à l'écran d'accueil pour une icône façon app native. `render.yaml` à la racine du dépôt décrit déjà tout ça.

Limite à connaître : les notifications du minuteur en arrière-plan ne fonctionnent pas dans cette version web (comme dans Expo Go) — il faudra la vraie app native (TestFlight) pour ça plus tard.

1. **Base de données** — crée un cluster gratuit sur [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) (pas de carte bancaire requise pour le tier M0). Dans *Network Access*, autorise `0.0.0.0/0` (accès depuis n'importe où — suffisant pour un projet perso). Récupère la chaîne de connexion (*Connect → Drivers*), du genre `mongodb+srv://user:pass@cluster.mongodb.net/`.
2. **Déploiement** — crée un compte gratuit sur [render.com](https://render.com) (connexion via GitHub), puis **New → Blueprint**, sélectionne le dépôt `iWeeZyy/Baker`. Render détecte `render.yaml` et propose de créer deux services : `bakers-backend` et `bakers-frontend`.
3. Avant de valider, renseigne les variables demandées :
   - `bakers-backend` → `MONGO_URL` (l'URL Atlas de l'étape 1) et `ANTHROPIC_API_KEY` (ta clé console.anthropic.com).
   - `bakers-frontend` → `EXPO_PUBLIC_BACKEND_URL` : laisse vide pour l'instant, tu la renseigneras à l'étape suivante.
4. Lance le déploiement. Une fois `bakers-backend` en ligne (statut *Live*), copie son URL (`https://bakers-backend-xxxx.onrender.com`), colle-la dans la variable `EXPO_PUBLIC_BACKEND_URL` du service `bakers-frontend` (onglet *Environment*), puis relance son déploiement (*Manual Deploy*).
5. Ouvre l'URL de `bakers-frontend` dans Safari sur ton iPhone. *Partager* → *Sur l'écran d'accueil* pour une icône dédiée.

Le tier gratuit de Render met le backend en veille après 15 min d'inactivité — la première requête après une pause prend quelques dizaines de secondes le temps qu'il se réveille, c'est normal.

## Build iOS / TestFlight (EAS)

1. Crée un compte gratuit sur [expo.dev](https://expo.dev) et un compte [Apple Developer Program](https://developer.apple.com/programs/) (99 $/an, obligatoire pour distribuer sur TestFlight).
2. Installe la CLI et connecte-toi :
   ```bash
   npm install -g eas-cli
   eas login
   ```
3. Dans `frontend/eas.json`, remplace `REPLACE-WITH-YOUR-BACKEND-URL` par l'URL de ton backend déployé (Railway, Render, Fly.io…) pour les profils `preview` et `production`.
4. Change si besoin `com.lucasmorey.levanea` (`frontend/app.json`, champs `ios.bundleIdentifier` et `android.package`) pour ton propre identifiant.
5. Build :
   ```bash
   cd frontend
   eas build --platform ios --profile preview
   ```
   EAS te guide pour générer les certificats/profils de provisioning automatiquement.
6. Une fois le build terminé, envoie-le sur TestFlight :
   ```bash
   eas submit --platform ios --latest
   ```

## Ce qui reste à faire pour une app "store-ready"

- Héberger le backend et MongoDB en production (aujourd'hui pensés pour tourner en local).
- Politique de confidentialité + CGU (obligatoires côté App Store vu la collecte de données utilisateur, photos, chat IA).
- Monitoring/crash reporting (Sentry ou équivalent).
- Tests automatisés en CI (les tests `backend/tests` visent désormais `http://localhost:8000` par défaut).
