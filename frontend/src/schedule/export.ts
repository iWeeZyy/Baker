import { Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
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

const GENERIC_IMAGE_ERROR =
  "L'image n'a pas pu être générée. Réessayez dans un instant.";

/** Capture the off-screen layout as a PNG file. */
async function captureImage(ref: any): Promise<string> {
  if (!ref?.current) throw new Error('layout indisponible');
  return await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
}

/**
 * Save the schedule to the camera roll.
 *
 * Photos is native-only: on the web build there is no camera roll to write to,
 * so the caller is told plainly rather than being handed a silent failure.
 */
export async function saveToPhotos(ref: any): Promise<ExportResult> {
  if (Platform.OS === 'web') {
    return { ok: false, message: "L'enregistrement dans Photos n'est disponible que sur l'application iPhone." };
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
        ? "Baker a besoin de votre autorisation pour enregistrer dans Photos."
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
 * Hand the schedule to the iOS print sheet.
 *
 * Printed from HTML rather than from the captured image: a 15-row table
 * rasterised at phone resolution is barely readable on paper, whereas this
 * stays vectorial and fits A4 landscape.
 */
export async function printSchedule(schedule: Schedule): Promise<ExportResult> {
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
 * Share through the native iOS sheet — Messages, Mail, WhatsApp and anything
 * else installed, without Baker integrating any of them.
 */
export async function shareSchedule(ref: any, schedule: Schedule): Promise<ExportResult> {
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
