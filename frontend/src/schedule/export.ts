import { Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Print from 'expo-print';
import * as MediaLibrary from 'expo-media-library';
import { scheduleHtml } from './printHtml';
import { weekTitle, type Schedule } from './model';

/**
 * Every action reports back the same way, so the screen shows one message and
 * never has to guess whether something half-succeeded. An export failing is
 * never allowed to throw into the render tree: a schedule that cannot be
 * printed must still be editable.
 */
export type ExportResult =
  | { ok: true; message: string }
  | { ok: false; message: string; needsSettings?: boolean };

const GENERIC_IMAGE_ERROR = "L'image n'a pas pu être générée. Réessayez dans un instant.";

const isWeb = Platform.OS === 'web';
/** Fallback width if the node has not been measured yet. */
const EXPORT_CAPTURE_WIDTH = 2245;

/** A4 landscape in millimetres, the page every export targets. */
const A4_LANDSCAPE = { w: 297, h: 210 };

/**
 * Build an A4-landscape PDF of the schedule, web only.
 *
 * The page geometry lives inside the file, so iOS cannot re-lay it out or fall
 * back to portrait — which is exactly what CSS `@page` could not guarantee in
 * Safari. The grid is embedded as the captured bitmap at roughly 325 dpi.
 */
async function buildPdf(ref: any, schedule: Schedule): Promise<Blob> {
  const dataUri = await captureImage(ref, 'jpeg');
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Fit the page while keeping the capture's proportions, then centre it.
  const img = doc.getImageProperties(dataUri);
  const ratio = Math.min(A4_LANDSCAPE.w / img.width, A4_LANDSCAPE.h / img.height);
  const w = img.width * ratio;
  const h = img.height * ratio;

  doc.addImage(dataUri, 'JPEG', (A4_LANDSCAPE.w - w) / 2, (A4_LANDSCAPE.h - h) / 2, w, h);
  doc.setProperties({ title: `Emploi du temps — ${schedule.week_start}` });
  return doc.output('blob');
}

function fileName(schedule: Schedule) {
  return `emploi-du-temps-${schedule.week_start}.png`;
}

/**
 * Capture the off-screen layout as a PNG.
 *
 * On the web this cannot go through `react-native-view-shot`: its `captureRef`
 * resolves the ref with `findNodeHandle`, which react-native-web does not
 * implement and which throws. Since a react-native-web ref already *is* the DOM
 * node, html2canvas is handed it directly — that is exactly what view-shot's own
 * web module does once the handle is resolved.
 */
async function captureImage(ref: any, format: 'png' | 'jpeg' = 'png'): Promise<string> {
  if (!ref?.current) throw new Error('layout indisponible');

  if (isWeb) {
    const html2canvas = (await import('html2canvas')).default;
    const node = ref.current as unknown as HTMLElement;

    // iOS caps a canvas at roughly 4096 px a side; past that Safari hands back
    // a blank or truncated bitmap. The scale is therefore capped so the page
    // stays comfortably inside that limit whatever its declared width.
    const MAX_CANVAS_PX = 3800;
    const width = node.offsetWidth || EXPORT_CAPTURE_WIDTH;
    const height = node.offsetHeight || width;
    const scale = Math.min(2, MAX_CANVAS_PX / Math.max(width, height));

    const canvas = await html2canvas(node, {
      backgroundColor: '#ffffff',
      scale: Math.max(1, scale),
      logging: false,
    });
    // JPEG for the PDF: the same bitmap stored as PNG makes a 40 MB file,
    // which no one can send by message. At 0.92 on a white table the
    // difference is invisible.
    return format === 'jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
  }

  return await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
}

async function dataUriToFile(uri: string, name: string): Promise<File> {
  const blob = await (await fetch(uri)).blob();
  return new File([blob], name, { type: 'image/png' });
}

/**
 * Hand a PNG to the browser's share sheet.
 *
 * On iOS Safari this is the only route that reaches the camera roll: the sheet
 * offers "Enregistrer l'image". `expo-sharing` cannot be used — its web
 * implementation shares a URL, never a file.
 */
async function shareFileOnWeb(ref: any, schedule: Schedule): Promise<ExportResult> {
  let file: File;
  try {
    file = await dataUriToFile(await captureImage(ref), fileName(schedule));
  } catch {
    return { ok: false, message: GENERIC_IMAGE_ERROR };
  }

  const nav: any = typeof navigator === 'undefined' ? null : navigator;
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: weekTitle(schedule.week_start) });
      return { ok: true, message: '' };
    } catch (e: any) {
      // Dismissing the sheet is a normal action, not a failure.
      if (e?.name === 'AbortError') return { ok: true, message: '' };
    }
  }

  // No share sheet: hand the file over as a download instead of failing.
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { ok: true, message: 'Image téléchargée.' };
  } catch {
    return { ok: false, message: "L'image n'a pas pu être partagée." };
  }
}

/**
 * Save the schedule to the camera roll.
 *
 * Native writes straight to Photos. On the web there is no camera roll to write
 * to, so the share sheet is offered instead — from there, "Enregistrer l'image"
 * puts it in Photos all the same.
 */
export async function saveToPhotos(ref: any, schedule: Schedule): Promise<ExportResult> {
  if (isWeb) {
    const res = await shareFileOnWeb(ref, schedule);
    if (res.ok && !res.message) {
      return { ok: true, message: 'Choisissez « Enregistrer l’image » pour l’ajouter à Photos.' };
    }
    return res;
  }

  let permission;
  try {
    permission = await MediaLibrary.requestPermissionsAsync();
  } catch {
    return { ok: false, message: "L'autorisation d'accès à Photos n'a pas pu être demandée." };
  }

  if (!permission.granted) {
    return {
      ok: false,
      // canAskAgain false means the prompt will never reappear: the only way
      // through is the Settings app, so say so instead of inviting a retry.
      message: permission.canAskAgain
        ? 'Baker a besoin de votre autorisation pour enregistrer dans Photos.'
        : "L'accès à Photos est refusé. Autorisez-le dans Réglages › Baker › Photos.",
      needsSettings: !permission.canAskAgain,
    };
  }

  let uri: string;
  try {
    uri = await captureImage(ref);
  } catch {
    return { ok: false, message: GENERIC_IMAGE_ERROR };
  }

  try {
    await MediaLibrary.saveToLibraryAsync(uri);
    return { ok: true, message: 'Emploi du temps enregistré dans Photos.' };
  } catch {
    return { ok: false, message: "L'image n'a pas pu être enregistrée dans Photos." };
  }
}

/**
 * Print the grid, never the screen.
 *
 * `expo-print` on web ignores the HTML and calls `window.print()`, which prints
 * whatever the app is displaying — buttons included. The web path therefore
 * writes the layout into a hidden iframe and prints that instead.
 */
/**
 * Print the grid, never the screen.
 *
 * `expo-print` on web ignores the HTML and calls `window.print()`, which prints
 * whatever the app is displaying — buttons included. The web path therefore
 * prints the main document with the app hidden and the grid put in its place:
 * iOS Safari only ever prints the top-level page, and lays a hidden iframe out
 * at zero width, which produced a blank sheet.
 */
export async function printSchedule(ref: any, schedule: Schedule): Promise<ExportResult> {
  if (isWeb) {
    // A PDF rather than window.print(): Safari ignores `@page { size }`, so a
    // printed web page came out portrait however the CSS asked. Handing iOS a
    // file that is already A4 landscape removes the question entirely.
    let pdf: File;
    try {
      const blob = await buildPdf(ref, schedule);
      pdf = new File([blob], `emploi-du-temps-${schedule.week_start}.pdf`, { type: 'application/pdf' });
    } catch {
      return { ok: false, message: "Le document n'a pas pu être préparé." };
    }

    const nav: any = typeof navigator === 'undefined' ? null : navigator;
    if (nav?.canShare?.({ files: [pdf] })) {
      try {
        await nav.share({ files: [pdf], title: weekTitle(schedule.week_start) });
        return { ok: true, message: '' };
      } catch (e: any) {
        if (e?.name === 'AbortError') return { ok: true, message: '' };
      }
    }

    // No share sheet (desktop browsers): open the PDF so it can be printed.
    try {
      const url = URL.createObjectURL(pdf);
      const win = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (!win) return { ok: true, message: 'Document PDF prêt : autorisez la fenêtre pour l\'imprimer.' };
      return { ok: true, message: '' };
    } catch {
      return { ok: false, message: "L'impression n'a pas pu être lancée." };
    }
  }

  try {
    await Print.printAsync({
      html: scheduleHtml(schedule),
      orientation: Print.Orientation.landscape,
    });
    return { ok: true, message: '' };
  } catch (e: any) {
    // Dismissing the print sheet surfaces as an error on iOS; that is a normal
    // user action, not a failure worth reporting.
    if (/cancel|dismiss/i.test(e?.message || '')) return { ok: true, message: '' };
    return { ok: false, message: "L'impression n'a pas pu être lancée." };
  }
}

/**
 * Share through the native sheet — Messages, Mail, WhatsApp and anything else
 * installed, without Baker integrating any of them.
 */
export async function shareSchedule(ref: any, schedule: Schedule): Promise<ExportResult> {
  if (isWeb) return await shareFileOnWeb(ref, schedule);

  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync().catch(() => false))) {
    return { ok: false, message: "Le partage n'est pas disponible sur cet appareil." };
  }

  let uri: string;
  try {
    uri = await captureImage(ref);
  } catch {
    return { ok: false, message: GENERIC_IMAGE_ERROR };
  }

  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: weekTitle(schedule.week_start),
      UTI: 'public.png',
    });
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: "Le partage n'a pas pu être lancé." };
  }
}
