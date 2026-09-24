/**
 * Ouvrir / partager / imprimer une fiche HACCP, adapté au format réel du
 * fichier (PDF ou Excel) et à la plateforme — même patron `{ ok, message }`
 * que `schedule/export.ts` (jamais un throw dans l'arbre de rendu ; l'écran
 * affiche toujours le même type de message, qu'une action ait à moitié
 * réussi ou pas).
 *
 * Les fichiers restent hébergés chez Méthode HACCP (voir `hygiene/fiches.ts`)
 * — ouvrir/partager/imprimer suppose donc une connexion, à la différence de
 * la recherche qui reste, elle, entièrement locale.
 */
import { Linking, Platform } from 'react-native';
import type { HygieneFile } from '@/src/hygiene/fiches';

export type DocActionResult = { ok: true; message: string } | { ok: false; message: string };

const isWeb = Platform.OS === 'web';

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').pop() || 'document');
  } catch {
    return 'document';
  }
}

const MIME_BY_FORMAT: Record<HygieneFile['format'], string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Ouvrir le document — l'action la plus simple et la plus fiable partout :
 * sur le web, le navigateur affiche un PDF nativement ou télécharge un
 * Excel automatiquement ; sur natif, `Linking.openURL` remet la main à
 * l'app système capable d'ouvrir l'URL (visionneuse PDF, Fichiers…).
 */
export async function openFicheFile(file: HygieneFile): Promise<DocActionResult> {
  try {
    await Linking.openURL(file.url);
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: "Le document n'a pas pu être ouvert." };
  }
}

async function downloadToCache(file: HygieneFile): Promise<string> {
  // API objets (`File`/`Directory`/`Paths`), pas `expo-file-system/legacy`
  // (bloqué par `scripts/cmd-guard.js`) ni les fonctions dépréciées du
  // module racine (`downloadAsync` lève désormais au runtime).
  const { File, Paths } = await import('expo-file-system');
  const downloaded = await File.downloadFileAsync(file.url, Paths.cache);
  return downloaded.uri;
}

/**
 * Partager (ou, de fait, télécharger) le document.
 *
 * Natif : téléchargement dans le cache puis la feuille de partage système
 * (Enregistrer dans Fichiers, Mail, AirDrop…) — même enchaînement que
 * `shareSchedule` dans `schedule/export.ts`. Web : `navigator.share` avec le
 * fichier quand il est disponible (mobile Safari/Chrome), sinon un
 * téléchargement direct via une ancre — c'est la même bascule que
 * `shareFileOnWeb`, ici appliquée à un fichier distant plutôt qu'à une
 * capture d'écran.
 */
export async function shareFicheFile(file: HygieneFile, ficheTitle: string): Promise<DocActionResult> {
  if (isWeb) {
    try {
      const res = await fetch(file.url);
      const blob = await res.blob();
      const name = fileNameFromUrl(file.url);
      const webFile = new File([blob], name, { type: MIME_BY_FORMAT[file.format] });

      const nav: any = typeof navigator === 'undefined' ? null : navigator;
      if (nav?.canShare?.({ files: [webFile] })) {
        try {
          await nav.share({ files: [webFile], title: ficheTitle });
          return { ok: true, message: '' };
        } catch (e: any) {
          if (e?.name === 'AbortError') return { ok: true, message: '' };
        }
      }

      const url = URL.createObjectURL(webFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { ok: true, message: 'Document téléchargé.' };
    } catch {
      return { ok: false, message: "Le document n'a pas pu être téléchargé." };
    }
  }

  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync().catch(() => false))) {
    return { ok: false, message: "Le partage n'est pas disponible sur cet appareil." };
  }

  let uri: string;
  try {
    uri = await downloadToCache(file);
  } catch {
    return { ok: false, message: "Le document n'a pas pu être téléchargé." };
  }

  try {
    await Sharing.shareAsync(uri, { mimeType: MIME_BY_FORMAT[file.format], dialogTitle: ficheTitle });
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: "Le partage n'a pas pu être lancé." };
  }
}

/**
 * Imprimer — réservé aux PDF (un Excel n'a pas de mise en page imprimable
 * sans passer par un tableur, hors périmètre ici). Natif : téléchargement
 * puis `Print.printAsync({ uri })`, qui imprime le PDF tel quel plutôt que
 * de le regénérer. Web : ouverture dans un nouvel onglet — le lecteur PDF
 * intégré du navigateur porte son propre bouton d'impression ; appeler
 * `window.print()` sur une fenêtre cross-origin échouerait silencieusement.
 */
export async function printFicheFile(file: HygieneFile, ficheTitle: string): Promise<DocActionResult> {
  if (file.format !== 'pdf') {
    return { ok: false, message: "Ce format ne peut pas être imprimé directement." };
  }

  if (isWeb) {
    try {
      const win = window.open(file.url, '_blank');
      if (!win) return { ok: true, message: "Document ouvert : utilisez l'icône d'impression du lecteur PDF." };
      return { ok: true, message: "Utilisez l'icône d'impression du lecteur PDF." };
    } catch {
      return { ok: false, message: "L'impression n'a pas pu être lancée." };
    }
  }

  let uri: string;
  try {
    uri = await downloadToCache(file);
  } catch {
    return { ok: false, message: "Le document n'a pas pu être téléchargé." };
  }

  try {
    const Print = await import('expo-print');
    await Print.printAsync({ uri });
    return { ok: true, message: '' };
  } catch (e: any) {
    if (/cancel|dismiss/i.test(e?.message || '')) return { ok: true, message: '' };
    return { ok: false, message: "L'impression n'a pas pu être lancée." };
  }
}
