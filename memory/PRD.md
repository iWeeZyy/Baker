# BAKERS - Product Requirements Document

## Vision
Application mobile React Native (Expo) dédiée aux boulangers, regroupant recettes classiques françaises, astuces techniques et partage communautaire.

## Core Features
1. **Auth**: Email/password (JWT) + Google Auth (Emergent managed)
2. **Recipe Library**: 20 recettes classiques préchargées (baguette, croissants, brioches, viennoiseries, pâtisseries), filtre par catégorie
3. **Recipe Detail**: Photo hero, méta (difficulté, temps, hydratation), ingrédients + préparation en onglets
4. **Community Sharing**: Formulaire pour partager sa recette avec photo (upload via Emergent Object Storage)
5. **AI Assistant**: Chat avec Claude Sonnet 5 pour questions techniques (fermentation, dépannage)
6. **Tips**: 8 astuces techniques par catégorie
7. **Favorites**: Sauvegarder des recettes
8. **Profile**: Voir ses recettes partagées et favorites

## Tech Stack
- Frontend: Expo SDK 54, expo-router, expo-image, expo-image-picker, expo-secure-store
- Backend: FastAPI, MongoDB (motor), emergentintegrations
- AI: Claude Sonnet 5 via EMERGENT_LLM_KEY
- Storage: Emergent Object Storage
- Auth: JWT (email/pw) + Emergent Google OAuth

## Design
"Editorial Mobile LIGHT" - warm artisanal (Georgia serif, palette pain/farine/bois) + moderne épuré (whitespace, minimalist cards, brand orange #C05A35).

## Navigation
Bottom tabs: Accueil / Recettes / Assistant / Profil
+ Stack screens: /auth, /recipe/[id], /share, /calculator

## Implemented Features (updated 2026-08-14)
- Iteration 1-2: Auth (email+Google), 20 recettes seed, tips, favoris, partage avec photo, assistant IA Claude Sonnet 5, profil
- Iteration 3: Aimer & Commenter (likes + comments par recette), Calculateur du boulanger (pourcentages boulanger, mode farine/pâte, hydratation/sel/levure/levain), Minuteur intégré (détecte durées dans les étapes, barre flottante pause/stop), Notes personnelles par recette (onglet Communauté)
- Iteration 4: Réponses aux avis (commentaires en fil / threaded), Minuteur multi-étapes (séquence enchaînée avec skip), Partager le calcul (bouton "Enregistrer comme recette" pré-remplit le formulaire de partage), Badges "Coup de cœur" (top 5 recettes les plus aimées, badge sur cartes + section dédiée sur l'accueil)
