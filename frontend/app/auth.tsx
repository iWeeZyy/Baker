import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { Button } from '@/src/Button';

// La grande photo de four (`auth-hero.jpg`, fournie par Lucas) a été retirée
// de cet écran lors de la refonte premium/minimaliste — sa présence en
// bannière avec un gros titre par-dessus contredisait l'objectif « aéré,
// logo et formulaire au centre ». Le fichier reste sur le disque, inutilisé,
// au cas où — même logique que les .svg/.png de secours laissés en place
// ailleurs dans le projet (voir CLAUDE.md, section « Recipe families »).
export default function AuthScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Purement visuel — le contour terracotta au focus d'un champ. N'affecte
  // ni la validation, ni la soumission.
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  if (user) return <Redirect href="/(tabs)" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brandBlock}>
            <Image source={require('../assets/images/icon.png')} style={styles.logo} contentFit="contain" />
            <Text style={styles.title}>Bienvenue sur Levanea</Text>
            <Text style={styles.subtitle}>L'art de la boulangerie française</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Adresse e-mail</Text>
              <TextInput
                testID="input-email"
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                placeholder="Votre adresse e-mail"
                placeholderTextColor={colors.muted}
                style={[styles.input, focusedField === 'email' && styles.inputFocused]}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Mot de passe</Text>
              <TextInput
                testID="input-password"
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                placeholder="Votre mot de passe"
                placeholderTextColor={colors.muted}
                style={[styles.input, focusedField === 'password' && styles.inputFocused]}
                secureTextEntry
                autoComplete="password"
              />
            </View>

            {error ? <Text style={styles.error} testID="auth-error">{error}</Text> : null}

            <Button
              testID="submit-auth"
              onPress={submit}
              loading={loading}
              label="Se connecter"
              style={styles.submitBtn}
            />
          </View>

          <Pressable testID="go-to-signup" onPress={() => router.push('/signup')} style={styles.signupLink}>
            <Text style={styles.signupLinkText}>Pas encore de compte ? <Text style={styles.signupLinkStrong}>Créer un compte</Text></Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  brandBlock: { alignItems: 'center', marginBottom: 44 },
  logo: { width: 88, height: 88, marginBottom: 24 },
  title: { fontFamily: theme.serif, fontSize: 30, color: colors.onSurface, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 8 },
  form: { gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 13, color: colors.onSurfaceSecondary, fontWeight: '500', letterSpacing: 0.2 },
  input: {
    fontSize: 16,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    // react-native-web dessine sinon le contour de focus natif du navigateur
    // (un anneau noir) par-dessus notre bordure terracotta au focus.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
  },
  inputFocused: { borderColor: colors.brand },
  error: { color: colors.error, fontSize: 13, textAlign: 'center' },
  submitBtn: { borderRadius: theme.radius.xl, marginTop: 4 },
  signupLink: { marginTop: 32, alignItems: 'center' },
  signupLinkText: { fontSize: 14, color: colors.muted },
  signupLinkStrong: { color: colors.brand, fontWeight: '600' },
});
