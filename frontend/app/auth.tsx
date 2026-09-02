import { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';
import { Button } from '@/src/Button';

export default function AuthScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          {/* Une vraie photo de four, fournie par Lucas, plutôt que le dessin
              d'archétype qui servait de repli ici — c'est le premier écran de
              l'application. */}
          <Image source={require('../assets/images/auth-hero.jpg')} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient colors={['transparent', 'rgba(42,31,26,0.85)']} style={StyleSheet.absoluteFillObject} />
          <View style={styles.heroContent}>
            <Text style={styles.brandLabel}>LEVANEA</Text>
            <Text style={styles.heroTitle}>L'art de la boulangerie française</Text>
          </View>
        </View>

        <View style={styles.form}>
          <View style={styles.tabs}>
            <View style={[styles.tab, styles.tabActive]}>
              <Text style={[styles.tabText, styles.tabTextActive]}>Connexion</Text>
            </View>
            <Pressable testID="tab-signup" onPress={() => router.push('/signup')} style={styles.tab}>
              <Text style={styles.tabText}>Inscription</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput testID="input-email" value={email} onChangeText={setEmail} placeholder="email@exemple.com" placeholderTextColor={colors.muted} style={styles.input} keyboardType="email-address" autoCapitalize="none" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput testID="input-password" value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={colors.muted} style={styles.input} secureTextEntry />
          </View>

          {error ? <Text style={styles.error} testID="auth-error">{error}</Text> : null}

          <Button testID="submit-auth" onPress={submit} loading={loading} label="Se connecter" style={{ marginTop: 8 }} />

          <Pressable testID="go-to-signup" onPress={() => router.push('/signup')} style={styles.signupLink}>
            <Text style={styles.signupLinkText}>Pas encore de compte ? <Text style={styles.signupLinkStrong}>Créer un compte</Text></Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.surface },
  hero: { height: 320, position: 'relative', backgroundColor: colors.surfaceSecondary },
  heroContent: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  brandLabel: { fontSize: 12, letterSpacing: 4, color: colors.onSurfaceInverse, marginBottom: 8, fontWeight: '500' },
  heroTitle: { fontFamily: theme.serif, fontSize: 32, color: colors.onSurfaceInverse, lineHeight: 36 },
  form: { padding: 24, paddingBottom: 48 },
  tabs: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: 4, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 4 },
  tabActive: { backgroundColor: colors.surface },
  tabText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  tabTextActive: { color: colors.onSurface },
  field: { marginBottom: 16 },
  label: { fontSize: 12, color: colors.muted, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' },
  input: { fontSize: 16, color: colors.onSurface, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 10 },
  error: { color: colors.error, fontSize: 13, marginBottom: 8 },
  signupLink: { marginTop: 20, alignItems: 'center' },
  signupLinkText: { fontSize: 13, color: colors.muted },
  signupLinkStrong: { color: colors.brand, fontWeight: '600' },
});
