import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Linking, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { storage } from '@/src/utils/storage';
import { api } from '@/src/api';
import { ONBOARDING_COMPLETED_KEY, SIGNUP_DRAFT_KEY } from '@/src/onboarding/storageKeys';
import { StepDots } from '@/src/onboarding/StepDots';
import { useUsernameAvailability } from '@/src/onboarding/useUsernameAvailability';
import { uploadAvatar } from '@/src/avatarUpload';
import { parseInstagramUsername } from '@/src/instagram';
import { ActionSheet } from '@/src/ActionSheet';
import { Chip } from '@/src/Chip';
import { Button } from '@/src/Button';

const PHASES = ['email', 'password', 'firstname', 'username', 'photo', 'bio', 'instagram', 'profession', 'specialties', 'review'] as const;
type Phase = typeof PHASES[number];

const PROFESSION_CHIPS = ['Boulanger', 'Pâtissier', 'Boulanger-pâtissier', 'Apprenti', 'Chef boulanger', 'Responsable', 'Autre'];

const SPECIALTY_CHIPS: { key: string; label: string }[] = [
  { key: 'pain', label: '🥖 Pain' },
  { key: 'viennoiserie', label: '🥐 Viennoiserie' },
  { key: 'patisserie', label: '🍰 Pâtisserie' },
  { key: 'levain', label: '🌾 Levain' },
  { key: 'pain_traditionnel', label: '🍞 Pain traditionnel' },
  { key: 'autre', label: '🥨 Autre' },
];

type Draft = {
  email?: string; firstName?: string; username?: string; bio?: string;
  instagram?: string; profession?: string | null; professionOther?: string; specialties?: string[];
};

export default function SignupScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { register, refreshUser } = useAuth();

  const [phaseIndex, setPhaseIndex] = useState(0);
  const phase: Phase = PHASES[phaseIndex];

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [firstName, setFirstName] = useState('');

  const [username, setUsername] = useState('');
  const usernameStatus = useUsernameAvailability(username);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [bio, setBio] = useState('');

  const [instagram, setInstagram] = useState('');
  const instagramTrimmed = instagram.trim();
  const instagramValid = instagramTrimmed ? parseInstagramUsername(instagramTrimmed) : null;
  const instagramInvalid = !!instagramTrimmed && !instagramValid;

  const [profession, setProfession] = useState<string | null>(null);
  const [professionOther, setProfessionOther] = useState('');

  const [specialties, setSpecialties] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reprise après fermeture de l'app en plein milieu de l'inscription : tout
  // sauf le mot de passe et la photo (jamais persistés) est réhydraté, et on
  // reprend systématiquement à l'étape mot de passe (le premier champ non
  // sauvegardé), jamais plus loin.
  useEffect(() => {
    storage.getItem<string>(SIGNUP_DRAFT_KEY, '').then((raw) => {
      if (!raw) return;
      try {
        const draft: Draft = JSON.parse(raw);
        if (draft.email) setEmail(draft.email);
        if (draft.firstName) setFirstName(draft.firstName);
        if (draft.username) setUsername(draft.username);
        if (draft.bio) setBio(draft.bio);
        if (draft.instagram) setInstagram(draft.instagram);
        if (draft.profession !== undefined) setProfession(draft.profession);
        if (draft.professionOther) setProfessionOther(draft.professionOther);
        if (draft.specialties) setSpecialties(draft.specialties);
        setPhaseIndex(PHASES.indexOf('password'));
      } catch {}
    });
  }, []);

  const persistDraft = async () => {
    const draft: Draft = { email, firstName, username, bio, instagram, profession, professionOther, specialties };
    await storage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
  };

  const goNext = async () => {
    await persistDraft();
    setPhaseIndex((i) => i + 1);
  };

  const goBack = () => {
    if (phaseIndex === 0) { router.back(); return; }
    setPhaseIndex((i) => i - 1);
  };

  // Le bouton physique Android doit reculer d'une étape comme la flèche
  // maison, pas quitter le flux d'un coup (mot de passe/photo ne sont jamais
  // persistés, voir persistDraft plus haut).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phaseIndex === 0) { router.back(); return true; }
      setPhaseIndex((i) => i - 1);
      return true;
    });
    return () => sub.remove();
  }, [phaseIndex, router]);

  const submitEmail = async () => {
    setEmailError(null);
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setEmailError('Adresse e-mail invalide.'); return; }
    setCheckingEmail(true);
    try {
      const res = await api(`/auth/email-available?email=${encodeURIComponent(value)}`);
      if (!res.available) { setEmailError('Un compte existe déjà avec cet e-mail.'); return; }
      await goNext();
    } catch (e: any) {
      setEmailError(e.message || 'Erreur réseau, réessayez.');
    } finally {
      setCheckingEmail(false);
    }
  };

  const pickPhoto = async (kind: 'camera' | 'library') => {
    setPhotoSheetOpen(false);
    setPhotoError(null);
    const perm = kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert(
          kind === 'camera' ? 'Accès à la caméra refusé' : 'Accès à la photothèque refusé',
          `Autorisez l'accès dans Réglages › Levanea › ${kind === 'camera' ? 'Appareil photo' : 'Photos'}.`,
          [{ text: 'Annuler', style: 'cancel' }, { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() }],
        );
      } else {
        setPhotoError(kind === 'camera' ? 'Permission caméra refusée' : 'Permission photothèque refusée');
      }
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'] as any, quality: 0.8, allowsEditing: true, aspect: [1, 1] };
    const result = kind === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPhotoUri(asset.uri);
    setPhotoName(`avatar.${(asset.uri.split('.').pop() || 'jpg').toLowerCase()}`);
  };

  const finalProfession = profession === 'Autre' ? (professionOther.trim() || undefined) : (profession || undefined);

  const finalize = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await register({
        email: email.trim(),
        password,
        name: firstName.trim(),
        username,
        bio: bio.trim() || undefined,
        instagram_username: instagramValid || undefined,
        profession: finalProfession,
        specialties: specialties.length ? specialties : undefined,
      });
      if (photoUri) {
        try {
          await uploadAvatar(photoUri, photoName || undefined);
          await refreshUser();
        } catch {
          // L'échec de l'upload de l'avatar ne doit jamais faire échouer une
          // création de compte déjà réussie — l'utilisateur pourra réessayer
          // depuis son profil.
        }
      }
      await storage.setItem(ONBOARDING_COMPLETED_KEY, true);
      await storage.removeItem(SIGNUP_DRAFT_KEY);
      router.replace('/(tabs)');
    } catch (e: any) {
      setSubmitError(e.message || 'Erreur lors de la création du compte.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSpecialty = (key: string) => {
    setSpecialties((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const initial = (firstName || email || '?').slice(0, 1).toUpperCase();

  let continueLabel = 'Continuer';
  let continueDisabled = false;
  let onContinue: () => void = () => goNext();

  switch (phase) {
    case 'email':
      continueDisabled = checkingEmail || !email.trim();
      onContinue = submitEmail;
      break;
    case 'password':
      continueDisabled = password.length < 8;
      break;
    case 'firstname':
      continueDisabled = !firstName.trim();
      break;
    case 'username':
      continueDisabled = usernameStatus !== 'available';
      break;
    case 'photo':
      continueLabel = photoUri ? 'Continuer' : 'Passer';
      break;
    case 'bio':
      continueLabel = bio.trim() ? 'Continuer' : 'Passer';
      break;
    case 'instagram':
      continueLabel = instagramTrimmed ? 'Ajouter Instagram' : 'Passer';
      continueDisabled = instagramInvalid;
      break;
    case 'profession':
      continueLabel = profession ? 'Continuer' : 'Passer';
      continueDisabled = profession === 'Autre' && !professionOther.trim();
      break;
    case 'specialties':
      continueLabel = specialties.length ? 'Continuer' : 'Passer';
      break;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable testID="signup-back" onPress={goBack} style={styles.iconBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel="Retour">
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <StepDots count={PHASES.length} activeIndex={phaseIndex} />
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {phase === 'email' && (
            <>
              <Text style={styles.title}>Commençons par votre compte</Text>
              <Text style={styles.subtitle}>Votre adresse e-mail</Text>
              <TextInput
                testID="signup-email"
                value={email}
                onChangeText={(v) => { setEmail(v); setEmailError(null); }}
                placeholder="email@exemple.com"
                placeholderTextColor={colors.muted}
                style={styles.input}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
              />
              {emailError ? <Text style={styles.errorText} testID="signup-email-error">{emailError}</Text> : null}
              <Pressable testID="signup-go-login" onPress={() => router.push('/auth')} style={styles.linkRow}>
                <Text style={styles.linkText}>Déjà un compte ? <Text style={styles.linkStrong}>Se connecter</Text></Text>
              </Pressable>
            </>
          )}

          {phase === 'password' && (
            <>
              <Text style={styles.title}>Sécurisez votre compte</Text>
              <Text style={styles.subtitle}>Choisissez un mot de passe</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  testID="signup-password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  secureTextEntry={!showPassword}
                  autoFocus
                />
                <Pressable
                  testID="signup-toggle-password"
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={10}
                  style={{ padding: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.muted} />
                </Pressable>
              </View>
              <Text style={styles.hint}>8 caractères minimum.</Text>
            </>
          )}

          {phase === 'firstname' && (
            <>
              <Text style={styles.title}>Comment devons-nous vous appeler ?</Text>
              <Text style={styles.subtitle}>Votre prénom</Text>
              <TextInput
                testID="signup-firstname"
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Votre prénom"
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoFocus
              />
            </>
          )}

          {phase === 'username' && (
            <>
              <Text style={styles.title}>Choisissez votre nom d’utilisateur</Text>
              <Text style={styles.subtitle}>Il vous identifiera sur Levanea</Text>
              <View style={styles.usernameRow}>
                <Text style={styles.usernameAt}>@</Text>
                <TextInput
                  testID="signup-username"
                  value={username}
                  onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="lucas"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
              </View>
              {username.trim() ? (
                <View style={styles.availabilityRow}>
                  {usernameStatus === 'checking' && <ActivityIndicator size="small" color={colors.muted} />}
                  {usernameStatus === 'available' && (
                    <Text style={[styles.availabilityText, { color: colors.success }]} testID="signup-username-available">✓ Nom d’utilisateur disponible</Text>
                  )}
                  {usernameStatus === 'taken' && (
                    <Text style={[styles.availabilityText, { color: colors.error }]} testID="signup-username-taken">✕ Ce nom d’utilisateur est déjà utilisé</Text>
                  )}
                  {usernameStatus === 'invalid' && (
                    <Text style={[styles.availabilityText, { color: colors.error }]}>✕ 3 à 20 caractères : lettres, chiffres, underscore</Text>
                  )}
                </View>
              ) : null}
            </>
          )}

          {phase === 'photo' && (
            <>
              <Text style={styles.title}>Ajoutez une photo de profil</Text>
              <Text style={styles.subtitle}>Facultatif — vous pourrez la modifier plus tard.</Text>
              <Pressable
                testID="signup-photo-pick"
                onPress={() => setPhotoSheetOpen(true)}
                style={styles.avatarPicker}
                accessibilityRole="button"
                accessibilityLabel={photoUri ? 'Changer la photo de profil' : 'Ajouter une photo de profil'}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Feather name="camera" size={28} color={colors.muted} />
                  </View>
                )}
              </Pressable>
              {photoError ? <Text style={styles.errorText}>{photoError}</Text> : null}
              <ActionSheet
                visible={photoSheetOpen}
                title="Photo de profil"
                onClose={() => setPhotoSheetOpen(false)}
                options={[
                  { key: 'camera', icon: 'camera', label: 'Prendre une photo', onPress: () => pickPhoto('camera') },
                  { key: 'library', icon: 'image', label: 'Choisir dans Photos', onPress: () => pickPhoto('library') },
                ]}
              />
            </>
          )}

          {phase === 'bio' && (
            <>
              <Text style={styles.title}>Parlez-nous de vous</Text>
              <Text style={styles.subtitle}>Facultatif — visible sur votre profil.</Text>
              <TextInput
                testID="signup-bio"
                value={bio}
                onChangeText={(v) => setBio(v.slice(0, 300))}
                placeholder="Boulanger passionné par le levain et les pains traditionnels."
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.multiline]}
                multiline
                maxLength={300}
              />
              <Text style={styles.hint}>{bio.length} / 300</Text>
            </>
          )}

          {phase === 'instagram' && (
            <>
              <Text style={styles.title}>Votre Instagram</Text>
              <Text style={styles.subtitle}>Partagez votre Instagram avec la communauté Levanea.</Text>
              <TextInput
                testID="signup-instagram"
                value={instagram}
                onChangeText={setInstagram}
                placeholder="@votrecompte"
                placeholderTextColor={colors.muted}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {instagramInvalid ? <Text style={styles.errorText} testID="signup-instagram-error">Nom d’utilisateur ou lien Instagram invalide.</Text> : null}
              <Text style={styles.hint}>Jamais de mot de passe demandé — seulement votre nom d’utilisateur public.</Text>
            </>
          )}

          {phase === 'profession' && (
            <>
              <Text style={styles.title}>Quel est votre métier ?</Text>
              <Text style={styles.subtitle}>Facultatif — une simple information de profil.</Text>
              <View style={styles.chipsWrap}>
                {PROFESSION_CHIPS.map((chip) => (
                  <Chip
                    key={chip}
                    testID={`signup-profession-${chip}`}
                    label={chip}
                    active={profession === chip}
                    tone="brand"
                    onPress={() => setProfession(profession === chip ? null : chip)}
                  />
                ))}
              </View>
              {profession === 'Autre' && (
                <>
                  <TextInput
                    testID="signup-profession-other"
                    value={professionOther}
                    onChangeText={(v) => setProfessionOther(v.slice(0, 60))}
                    placeholder="Précisez votre métier"
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { marginTop: 16 }]}
                  />
                  {!professionOther.trim() ? <Text style={styles.hint}>Précisez votre métier pour continuer.</Text> : null}
                </>
              )}
            </>
          )}

          {phase === 'specialties' && (
            <>
              <Text style={styles.title}>Vos spécialités</Text>
              <Text style={styles.subtitle}>Facultatif — plusieurs choix possibles.</Text>
              <View style={styles.chipsWrap}>
                {SPECIALTY_CHIPS.map((chip) => (
                  <Chip
                    key={chip.key}
                    testID={`signup-specialty-${chip.key}`}
                    label={chip.label}
                    active={specialties.includes(chip.key)}
                    tone="brand"
                    onPress={() => toggleSpecialty(chip.key)}
                  />
                ))}
              </View>
            </>
          )}

          {phase === 'review' && (
            <>
              <Text style={styles.title}>Votre profil est prêt 👨‍🍳</Text>
              <View style={styles.reviewCard}>
                <View style={styles.reviewAvatar}>
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.avatarImage} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatarPlaceholder, { backgroundColor: colors.brand }]}>
                      <Text style={{ color: colors.onBrandPrimary, fontSize: 24, fontFamily: theme.serif }}>{initial}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.reviewName}>{firstName || 'Boulanger'}</Text>
                <Text style={styles.reviewUsername}>@{username}</Text>
                {finalProfession ? <Text style={styles.reviewProfession}>{finalProfession}</Text> : null}
                {bio.trim() ? <Text style={styles.reviewBio}>{bio.trim()}</Text> : null}
                {instagramValid ? (
                  <View style={styles.reviewInstagramRow}>
                    <Feather name="instagram" size={16} color={colors.brand} />
                    <Text style={styles.reviewInstagramText}>@{instagramValid}</Text>
                  </View>
                ) : null}
              </View>
              {submitError ? <Text style={styles.errorText} testID="signup-submit-error">{submitError}</Text> : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        {phase === 'review' ? (
          <Button testID="signup-finish" onPress={finalize} disabled={submitting} loading={submitting} label="Commencer avec Levanea" />
        ) : (
          <Button
            testID="signup-continue"
            onPress={onContinue}
            disabled={continueDisabled}
            loading={checkingEmail && phase === 'email'}
            label={continueLabel}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 24, paddingBottom: 40, flexGrow: 1 },
  title: { fontFamily: theme.serif, fontSize: 26, color: colors.onSurface, lineHeight: 32, marginBottom: 10 },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 24 },
  input: { fontSize: 16, color: colors.onSurface, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 10, marginBottom: 8 },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  errorText: { fontSize: 13, color: colors.error, marginTop: 4 },
  linkRow: { marginTop: 24, alignItems: 'center' },
  linkText: { fontSize: 13, color: colors.muted },
  linkStrong: { color: colors.brand, fontWeight: '600' },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  usernameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  usernameAt: { fontSize: 16, color: colors.muted, paddingBottom: 10 },
  availabilityRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center' },
  availabilityText: { fontSize: 13, fontWeight: '500' },
  avatarPicker: { alignSelf: 'center', marginTop: 12 },
  avatarImage: { width: 120, height: 120, borderRadius: theme.radius.pill },
  avatarPlaceholder: { width: 120, height: 120, borderRadius: theme.radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reviewCard: { alignItems: 'center', padding: 24, backgroundColor: colors.surfaceSecondary, borderRadius: theme.radius.lg, marginTop: 8 },
  reviewAvatar: { marginBottom: 16 },
  reviewName: { fontFamily: theme.serif, fontSize: 22, color: colors.onSurface },
  reviewUsername: { fontSize: 14, color: colors.muted, marginTop: 2 },
  reviewProfession: { fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 8 },
  reviewBio: { fontSize: 13, color: colors.onSurfaceSecondary, textAlign: 'center', marginTop: 12, lineHeight: 19 },
  reviewInstagramRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  reviewInstagramText: { fontSize: 13, color: colors.brand, fontWeight: '500' },
  footer: { paddingHorizontal: 24, paddingVertical: 16 },
});
