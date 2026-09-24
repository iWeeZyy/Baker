/**
 * Bibliothèque HACCP — section Hygiène.
 *
 * Source unique des fiches, même idiome que `families.py`/`products.py`
 * (liste ordonnée + table de correspondance), mais entièrement côté
 * frontend : contrairement aux familles/produits, rien ici n'a besoin d'un
 * calcul serveur, et la recherche doit fonctionner hors-ligne — donc pas de
 * route backend, pas de collection Mongo, un seul aller-retour... qui n'a
 * même pas lieu : tout est déjà dans le bundle.
 *
 * Contenu : 35 fiches réelles de Méthode HACCP (methodehaccp.com),
 * utilisées avec l'autorisation explicite de leur créateur. Les fichiers
 * eux-mêmes restent hébergés chez Méthode HACCP (hotlink direct vers leur
 * CDN WordPress) plutôt que copiés dans le dépôt — même principe déjà
 * appliqué à `recipe_photos.py`/Pexels : « rien n'est copié dans le dépôt »,
 * ce qui évite de figer 44 fichiers dans le bundle et garde les documents à
 * jour si Méthode HACCP les met à jour de leur côté.
 *
 * Deux registres n'ont volontairement pas de card dédiée ici : la liste des
 * guides de bonnes pratiques (GBPH) du site source n'est qu'un lien externe
 * vers agriculture.gouv.fr, pas un document téléchargeable en soi — voir la
 * note dans le rapport d'intégration plutôt qu'une fiche inventée pour
 * l'occasion.
 */

export type HygieneFileFormat = 'pdf' | 'excel';

export type HygieneDocKind = 'fiche' | 'registre' | 'plan' | 'checklist' | 'protocole' | 'affiche' | 'reglementaire';

export type HygieneCategoryKey =
  | 'temperatures' | 'nettoyage' | 'reception' | 'allergenes' | 'personnel'
  | 'nonconformites' | 'pilotage' | 'bonnespratiques' | 'reglementaire';

export type HygieneFile = {
  format: HygieneFileFormat;
  label: string;
  url: string;
};

export type HygieneFiche = {
  id: string;
  title: string;
  description: string;
  /** Lieu d'affichage suggéré par la fiche source (affiches uniquement). */
  placement?: string;
  category: HygieneCategoryKey;
  docKind: HygieneDocKind;
  keywords: string[];
  files: HygieneFile[];
};

export const HYGIENE_CATEGORIES: { key: HygieneCategoryKey; label: string }[] = [
  { key: 'temperatures', label: 'Températures' },
  { key: 'nettoyage', label: 'Nettoyage & désinfection' },
  { key: 'reception', label: 'Réception & fournisseurs' },
  { key: 'allergenes', label: 'Allergènes & traçabilité' },
  { key: 'personnel', label: 'Hygiène du personnel' },
  { key: 'nonconformites', label: 'Non-conformités & alertes' },
  { key: 'pilotage', label: 'Contrôle & pilotage' },
  { key: 'bonnespratiques', label: 'Bonnes pratiques' },
  { key: 'reglementaire', label: 'Documents réglementaires' },
];

export const HYGIENE_SOURCE_NAME = 'Méthode HACCP';
export const HYGIENE_SOURCE_URL = 'https://methodehaccp.com/';
export const HYGIENE_SOURCE_PAGE_URL = 'https://methodehaccp.com/documents-haccp-gratuits-a-telecharger/';

export const HYGIENE_FICHES: HygieneFiche[] = [
  {
    id: 'releve-des-temperatures-positives-les-frigos',
    title: 'Relevé des températures positives (les frigos !)',
    description: 'À coller sur vos frigos pour tracer les températures entre 0 et 5 °C.',
    placement: undefined,
    category: 'temperatures',
    docKind: 'fiche',
    keywords: ['frigo', 'frigos', 'refrigerateur', 'temperature', 'temperatures', 'positive', 'releve', 'enceinte positive', 'controle temperature'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/fiche-releve-temperature-enceinte-positive.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2025/06/releve-temperatures-positives.xlsx' },
    ],
  },
  {
    id: 'releve-des-temperatures-negatives-les-congels',
    title: 'Relevé des températures négatives (les congels !)',
    description: 'À coller sur vos congélateurs pour tracer les températures entre −22 et −18 °C.',
    placement: undefined,
    category: 'temperatures',
    docKind: 'fiche',
    keywords: ['congelateur', 'congelos', 'congels', 'temperature', 'temperatures', 'negative', 'releve', 'enceinte negative'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/06/fiche-releve-temperature-enceinte-negative.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2025/06/releve-temperatures-negatives.xlsx' },
    ],
  },
  {
    id: 'registre-des-allergenes-denrees-non-preemballees',
    title: 'Registre des allergènes (denrées non préemballées)',
    description: 'Recensez les allergènes présents dans vos produits — obligation INCO.',
    placement: undefined,
    category: 'allergenes',
    docKind: 'registre',
    keywords: ['allergenes', 'allergene', 'inco', 'denrees non preemballees', 'vrac'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/03/registre-allergenes.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/03/registre-allergenes.xlsx' },
    ],
  },
  {
    id: 'le-plan-de-nettoyage-et-desinfection',
    title: 'Le plan de nettoyage et désinfection',
    description: 'Qui nettoie quoi, quand, avec quoi — et la preuve signée.',
    placement: undefined,
    category: 'nettoyage',
    docKind: 'plan',
    keywords: ['nettoyage', 'desinfection', 'plan de nettoyage', 'hygiene des locaux', 'entretien'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/plan-nettoyage.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/plan-nettoyage.xlsx' },
    ],
  },
  {
    id: 'la-fiche-de-reception-des-marchandises',
    title: 'La fiche de réception des marchandises',
    description: 'Le contrôle en 30 secondes, pendant que le livreur est encore là.',
    placement: undefined,
    category: 'reception',
    docKind: 'fiche',
    keywords: ['reception', 'marchandises', 'livraison', 'livreur', 'controle reception', 'fournisseur'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/fiche-reception.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/fiche-reception.xlsx' },
    ],
  },
  {
    id: 'le-suivi-du-refroidissement-rapide',
    title: 'Le suivi du refroidissement rapide',
    description: 'De +63 à +10 °C en moins de 2 h, chronométré et signé.',
    placement: undefined,
    category: 'temperatures',
    docKind: 'fiche',
    keywords: ['refroidissement', 'refroidissement rapide', 'cellule de refroidissement', 'chaud vers froid', '63 10'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/suivi-refroidissement.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/suivi-refroidissement.xlsx' },
    ],
  },
  {
    id: 'le-registre-des-huiles-de-friture',
    title: 'Le registre des huiles de friture',
    description: 'Contrôles, filtrations, changements de bain : au-delà de 25 % de polaires, c’est non.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'registre',
    keywords: ['huile', 'huiles de friture', 'friture', 'polaires', 'bain de friture'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/registre-huiles.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/registre-huiles.xlsx' },
    ],
  },
  {
    id: 'le-registre-des-non-conformites',
    title: 'Le registre des non-conformités',
    description: 'Une anomalie n’est pas une faute ; une anomalie non tracée, si.',
    placement: undefined,
    category: 'nonconformites',
    docKind: 'registre',
    keywords: ['non-conformite', 'non conformite', 'anomalie', 'ecart', 'action corrective'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/registre-non-conformites.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/registre-non-conformites.xlsx' },
    ],
  },
  {
    id: 'letalonnage-des-thermometres',
    title: 'L’étalonnage des thermomètres',
    description: 'Deux verres d’eau, cinq minutes : la sonde qui fait foi doit dire vrai.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'fiche',
    keywords: ['thermometre', 'thermometres', 'etalonnage', 'sonde', 'verification sonde'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/etalonnage-thermometres.pdf' },
    ],
  },
  {
    id: 'le-plan-de-lutte-contre-les-nuisibles',
    title: 'Le plan de lutte contre les nuisibles',
    description: 'Postes numérotés, passages datés : le classeur que la DDPP ouvre en premier.',
    placement: undefined,
    category: 'nonconformites',
    docKind: 'plan',
    keywords: ['nuisibles', 'rongeurs', 'insectes', 'deratisation', 'desinsectisation', 'ddpp'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/plan-nuisibles.pdf' },
    ],
  },
  {
    id: 'le-registre-des-fournisseurs-et-agrements',
    title: 'Le registre des fournisseurs et agréments',
    description: 'La traçabilité commence en amont : coordonnées, agréments, fiches techniques.',
    placement: undefined,
    category: 'reception',
    docKind: 'registre',
    keywords: ['fournisseurs', 'agrements', 'fiches techniques', 'traçabilite amont'],
    files: [
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/fournisseurs-agrements.xlsx' },
    ],
  },
  {
    id: 'la-fiche-plats-temoins',
    title: 'La fiche plats témoins',
    description: '100 g, 5 jours, étiquetés : l’assurance-vie de la restauration collective.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'fiche',
    keywords: ['plats temoins', 'restauration collective', 'echantillon'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/fiche-plats-temoins.pdf' },
    ],
  },
  {
    id: 'le-suivi-des-formations-hygiene',
    title: 'Le suivi des formations hygiène',
    description: 'Qui a été formé à quoi, quand — l’échéance se calcule toute seule.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'registre',
    keywords: ['formations', 'formation hygiene', 'habilitation', 'echeance formation'],
    files: [
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/suivi-formations.xlsx' },
    ],
  },
  {
    id: 'le-suivi-des-congelations-maison',
    title: 'Le suivi des congélations maison',
    description: 'Qui congèle quoi, quand, décongelé comment — le jumeau des étiquettes.',
    placement: undefined,
    category: 'temperatures',
    docKind: 'fiche',
    keywords: ['congelation', 'congelation maison', 'decongelation', 'dlc'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/suivi-congelation.pdf' },
    ],
  },
  {
    id: 'les-etiquettes-de-tracabilite',
    title: 'Les étiquettes de traçabilité',
    description: 'À imprimer et découper pour dater vos produits entamés et vos préparations.',
    placement: undefined,
    category: 'allergenes',
    docKind: 'fiche',
    keywords: ['etiquettes', 'traçabilite', 'etiquetage', 'dlc', 'date', 'produits entames'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/03/etiquettes_tracabilite.pdf' },
    ],
  },
  {
    id: 'la-check-list-ouverture-fermeture',
    title: 'La check-list ouverture / fermeture',
    description: 'Les gestes du matin, les gestes du soir, à cocher sans réfléchir.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'checklist',
    keywords: ['ouverture', 'fermeture', 'checklist', 'check-list', 'routine'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/checklist-ouverture-fermeture.pdf' },
    ],
  },
  {
    id: 'linspection-blanche-etes-vous-pret',
    title: 'L’inspection blanche : êtes-vous prêt ?',
    description: '32 points, un score, zéro complaisance — le contrôle avant le contrôle.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'checklist',
    keywords: ['inspection', 'controle sanitaire', 'audit interne', 'autocontrole'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/inspection-blanche.pdf' },
      { format: 'excel', label: 'Excel (.xls)', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/inspection-blanche.xlsx' },
    ],
  },
  {
    id: 'le-sommaire-du-classeur-pms',
    title: 'Le sommaire du classeur PMS',
    description: 'Tout ce que votre Plan de Maîtrise Sanitaire doit contenir, en une page à cocher.',
    placement: undefined,
    category: 'pilotage',
    docKind: 'checklist',
    keywords: ['pms', 'plan de maitrise sanitaire', 'classeur', 'sommaire'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/sommaire-pms.pdf' },
    ],
  },
  {
    id: 'suspicion-de-tiac-le-protocole',
    title: 'Suspicion de TIAC : le protocole',
    description: 'Conserver, déclarer, coopérer — la chronologie de crise sans paniquer.',
    placement: undefined,
    category: 'nonconformites',
    docKind: 'protocole',
    keywords: ['tiac', 'toxi-infection', 'intoxication alimentaire', 'crise', 'declaration'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/protocole-tiac.pdf' },
    ],
  },
  {
    id: 'le-lavage-des-mains',
    title: 'Le lavage des mains',
    description: 'Pour que tout le monde sache pourquoi et comment bien se laver les mains.',
    placement: 'à côté des lavabos',
    category: 'personnel',
    docKind: 'affiche',
    keywords: ['lavage des mains', 'hygiene des mains', 'lavabo', 'se laver les mains'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/08/Affiche-HACCP-gratuites-bien-se-laver-les-mains.pdf' },
    ],
  },
  {
    id: 'les-couleurs-des-planches-a-decouper',
    title: 'Les couleurs des planches à découper',
    description: 'À chaque couleur son utilisation, pour ne pas s’emmêler les pinceaux !',
    placement: 'en cuisine',
    category: 'nettoyage',
    docKind: 'affiche',
    keywords: ['planches a decouper', 'couleurs', 'code couleur', 'contamination croisee'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/08/affiche-planches-a-decouper.pdf' },
    ],
  },
  {
    id: 'le-tableau-des-temperatures-de-conservation',
    title: 'Le tableau des températures de conservation',
    description: 'Les températures réglementaires par famille d’aliments, d’un coup d’œil.',
    placement: 'sur les frigos',
    category: 'temperatures',
    docKind: 'affiche',
    keywords: ['temperatures de conservation', 'tableau des temperatures', 'frigo'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/fiche-temperatures-conservation.pdf' },
    ],
  },
  {
    id: 'ne-brisez-pas-la-chaine-du-froid',
    title: 'Ne brisez pas la chaîne du froid',
    description: 'Les bonnes pratiques pour respecter la chaîne du froid, à afficher bien en vue.',
    placement: 'sur les frigos',
    category: 'temperatures',
    docKind: 'affiche',
    keywords: ['chaine du froid', 'rupture de la chaine du froid', 'frigo'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/08/Affiche-HACCP-gratuites-la-chaine-du-froid.pdf' },
    ],
  },
  {
    id: 'la-tenue-dhygiene-pour-bien-travailler',
    title: 'La tenue d’hygiène pour bien travailler',
    description: 'La tenue correcte est exigée ! À afficher dans les vestiaires des employés.',
    placement: 'dans les vestiaires',
    category: 'personnel',
    docKind: 'affiche',
    keywords: ['tenue', 'tenue d\'hygiene', 'vestiaire', 'tenue de travail'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/08/Affiche-HACCP-gratuites-la-tenue-ideale-hygiene.pdf' },
    ],
  },
  {
    id: 'la-fiche-recette',
    title: 'La fiche recette',
    description: 'Une recette claire, c’est une production maîtrisée — fini les improvisations.',
    placement: 'en production',
    category: 'bonnespratiques',
    docKind: 'affiche',
    keywords: ['fiche recette', 'recette de production', 'standardisation'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/01/fiche-recette-production.pdf' },
    ],
  },
  {
    id: 'que-faire-en-cas-de-coupure-electrique',
    title: 'Que faire en cas de coupure électrique ?',
    description: 'La démarche claire pour préserver la chaîne du froid sans paniquer.',
    placement: 'près du tableau électrique',
    category: 'temperatures',
    docKind: 'affiche',
    keywords: ['coupure electrique', 'panne electrique', 'panne de courant', 'chaine du froid'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/03/Affiche-HACCP-gratuites-que-faire-en-cas-de-coupure-electrique-.pdf' },
    ],
  },
  {
    id: 'la-marche-en-avant',
    title: 'La marche en avant',
    description: 'Du sale vers le propre, jamais l’inverse.',
    placement: 'plan du labo',
    category: 'bonnespratiques',
    docKind: 'affiche',
    keywords: ['marche en avant', 'sens de circulation', 'contamination croisee', 'plan du labo'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/affiche-marche-en-avant.pdf' },
    ],
  },
  {
    id: 'la-reception-des-marchandises',
    title: 'La réception des marchandises',
    description: 'Les 5 contrôles avant de signer le bon.',
    placement: 'à la porte de livraison',
    category: 'reception',
    docKind: 'affiche',
    keywords: ['reception', 'marchandises', 'livraison', '5 controles'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/affiche-reception.pdf' },
    ],
  },
  {
    id: 'le-refroidissement-rapide',
    title: 'Le refroidissement rapide',
    description: '63 → 10 en 2 h : la règle qui sauve vos préparations.',
    placement: 'près de la cellule',
    category: 'temperatures',
    docKind: 'affiche',
    keywords: ['refroidissement', 'refroidissement rapide', 'cellule'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/affiche-refroidissement.pdf' },
    ],
  },
  {
    id: 'les-7-principes-haccp',
    title: 'Les 7 principes HACCP',
    description: 'Toute la méthode sur un mur.',
    placement: 'dans le bureau ou la salle de pause',
    category: 'bonnespratiques',
    docKind: 'affiche',
    keywords: ['7 principes', 'haccp', 'methode haccp'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/affiche-7-principes.pdf' },
    ],
  },
  {
    id: 'bien-ranger-son-frigo',
    title: 'Bien ranger son frigo',
    description: 'Le cru ne prend jamais l’ascenseur : chaque étage a son locataire.',
    placement: 'sur la porte du frigo',
    category: 'temperatures',
    docKind: 'affiche',
    keywords: ['frigo', 'rangement du frigo', 'cru et cuit', 'etageres'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/07/affiche-ranger-frigo.pdf' },
    ],
  },
  {
    id: 'decret-0043-du-21-02-2024',
    title: 'Décret 0043 du 21/02/2024',
    description: 'Cahier des charges de la formation obligatoire en hygiène alimentaire (restauration commerciale).',
    placement: undefined,
    category: 'reglementaire',
    docKind: 'reglementaire',
    keywords: ['decret', 'formation obligatoire', 'hygiene alimentaire', 'restauration commerciale'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/06/decret-0043-du-21-02-2024.pdf' },
    ],
  },
  {
    id: 'reglement-europeen-178-de-2002',
    title: 'Règlement Européen 178 de 2002',
    description: 'Principes généraux de la législation alimentaire et procédures de sécurité des denrées.',
    placement: undefined,
    category: 'reglementaire',
    docKind: 'reglementaire',
    keywords: ['reglement europeen', '178/2002', 'legislation alimentaire', 'securite des denrees'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/08/178-2002.pdf' },
    ],
  },
  {
    id: 'reglement-europeen-852-de-2004',
    title: 'Règlement Européen 852 de 2004',
    description: 'Règles d’hygiène applicables à toutes les étapes de la chaîne alimentaire.',
    placement: undefined,
    category: 'reglementaire',
    docKind: 'reglementaire',
    keywords: ['reglement europeen', '852/2004', 'regles d\'hygiene', 'chaine alimentaire'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2025/06/reglement-europeen-852-2004.pdf' },
    ],
  },
  {
    id: 'cerfa-12211-02-tiac',
    title: 'Cerfa 12211-02 — TIAC',
    description: 'Déclaration obligatoire auprès de l’ARS en cas de toxi-infection alimentaire collective.',
    placement: undefined,
    category: 'nonconformites',
    docKind: 'reglementaire',
    keywords: ['cerfa', 'tiac', 'toxi-infection', 'declaration ars'],
    files: [
      { format: 'pdf', label: 'PDF', url: 'https://methodehaccp.com/wp-content/uploads/2026/03/cerfa-12211-02-toxi-infection-alimentaire-collective.pdf' },
    ],
  },
];
