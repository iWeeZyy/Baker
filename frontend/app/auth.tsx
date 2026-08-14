import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

export default function AuthScreen() {
  const { user, login, register, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') await register(email.trim(), password, name.trim() || email.split('@')[0]);
      else await login(email.trim(), password);
    } catch (e: any) {
      setError(e.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setError(null); setLoading(true);
    try { await loginWithGoogle(); } catch (e: any) { setError(e.message || 'Erreur Google'); }
    finally { setLoading(false); }
  };

  if (user) return <Redirect href="/(tabs)" />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Image source={{ uri: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=85' }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          <LinearGradient colors={['transparent', 'rgba(42,31,26,0.85)']} style={StyleSheet.absoluteFillObject} />
          <View style={styles.heroContent}>
            <Text style={styles.brandLabel}>BAKERS</Text>
            <Text style={styles.heroTitle}>L'art de la boulangerie française</Text>
          </View>
        </View>

        <View style={styles.form}>
          <View style={styles.tabs}>
            <Pressable testID="tab-login" onPress={() => setMode('login')} style={[styles.tab, mode === 'login' && styles.tabActive]}>
              <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Connexion</Text>
            </Pressable>
            <Pressable testID="tab-signup" onPress={() => setMode('signup')} style={[styles.tab, mode === 'signup' && styles.tabActive]}>
              <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Inscription</Text>
            </Pressable>
          </View>

          {mode === 'signup' && (
            <View style={styles.field}>
              <Text style={styles.label}>Nom</Text>
              <TextInput testID="input-name" value={name} onChangeText={setName} placeholder="Votre nom" placeholderTextColor={theme.color.muted} style={styles.input} />
            </View>
          )}
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput testID="input-email" value={email} onChangeText={setEmail} placeholder="email@exemple.com" placeholderTextColor={theme.color.muted} style={styles.input} keyboardType="email-address" autoCapitalize="none" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput testID="input-password" value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={theme.color.muted} style={styles.input} secureTextEntry />
          </View>

          {error ? <Text style={styles.error} testID="auth-error">{error}</Text> : null}

          <Pressable testID="submit-auth" onPress={submit} disabled={loading} style={[styles.primaryBtn, loading && { opacity: 0.6 }]}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{mode === 'login' ? 'Se connecter' : "S'inscrire"}</Text>}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OU</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable testID="google-btn" onPress={google} disabled={loading} style={styles.googleBtn}>
            <Feather name="chrome" size={18} color={theme.color.onSurface} />
            <Text style={styles.googleText}>Continuer avec Google</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: theme.color.surface },
  hero: { height: 320, position: 'relative' },
  heroContent: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  brandLabel: { fontSize: 12, letterSpacing: 4, color: theme.color.onSurfaceInverse, marginBottom: 8, fontWeight: '500' },
  heroTitle: { fontFamily: theme.serif, fontSize: 32, color: theme.color.onSurfaceInverse, lineHeight: 36 },
  form: { padding: 24, paddingBottom: 48 },
  tabs: { flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary, borderRadius: 4, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 4 },
  tabActive: { backgroundColor: theme.color.surface },
  tabText: { fontSize: 14, color: theme.color.muted, fontWeight: '500' },
  tabTextActive: { color: theme.color.onSurface },
  field: { marginBottom: 16 },
  label: { fontSize: 12, color: theme.color.muted, marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' },
  input: { fontSize: 16, color: theme.color.onSurface, borderBottomWidth: 1, borderBottomColor: theme.color.borderStrong, paddingVertical: 10 },
  primaryBtn: { backgroundColor: theme.color.brand, paddingVertical: 16, alignItems: 'center', borderRadius: 4, marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.color.border },
  dividerText: { marginHorizontal: 12, color: theme.color.muted, fontSize: 12, letterSpacing: 1 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 4, borderWidth: 1, borderColor: theme.color.borderStrong, gap: 10 },
  googleText: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  error: { color: theme.color.error, fontSize: 13, marginBottom: 8 },
});
