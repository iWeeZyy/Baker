import { useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/ThemeContext';

type Msg = { role: 'user' | 'assistant'; content: string; id?: string };

const SUGGESTIONS = [
  'Comment réussir mon levain ?',
  'Pourquoi ma pâte ne lève pas ?',
  'Température idéale pour la baguette ?',
  'Comment obtenir une belle grigne ?',
];

export default function Assistant() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    api('/chat/history').then((h: any[]) => {
      setMessages(h.map(m => ({ role: m.role, content: m.content })));
      setHistoryLoaded(true);
    }).catch(() => setHistoryLoaded(true));
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length, loading]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await api('/chat', { method: 'POST', body: JSON.stringify({ message: msg }) });
      setMessages(m => [...m, { role: 'assistant', content: res.reply }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', content: `Désolé, une erreur est survenue: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.brandLabel}>ASSISTANT IA</Text>
        <Text style={styles.title}>Le Maître Boulanger</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={80}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.chatBody} showsVerticalScrollIndicator={false}>
          {!historyLoaded ? (
            <ActivityIndicator color={colors.brand} />
          ) : messages.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Feather name="message-circle" size={32} color={colors.brand} /></View>
              <Text style={styles.emptyTitle}>Demandez-moi tout</Text>
              <Text style={styles.emptyBody}>Fermentation, hydratation, façonnage, dépannage… je suis là pour vous guider.</Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map(s => (
                  <Pressable key={s} testID={`suggestion-${s}`} onPress={() => send(s)} style={styles.suggestion}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m, i) => (
              <View key={i} style={[styles.bubble, m.role === 'user' ? styles.userBubble : styles.aiBubble]}>
                <Text style={[styles.bubbleText, m.role === 'user' ? styles.userText : styles.aiText]}>{m.content}</Text>
              </View>
            ))
          )}
          {loading && (
            <View style={[styles.bubble, styles.aiBubble]}>
              <ActivityIndicator color={colors.brand} size="small" />
            </View>
          )}
        </ScrollView>

        <View style={styles.inputRow}>
          <TextInput
            testID="chat-input"
            value={input}
            onChangeText={setInput}
            placeholder="Votre question…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            multiline
            onSubmitEditing={() => send()}
          />
          <Pressable testID="chat-send" onPress={() => send()} disabled={!input.trim() || loading} style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.4 }]}>
            <Feather name="arrow-up" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  brandLabel: { fontSize: 11, letterSpacing: 3, color: colors.muted, fontWeight: '500' },
  title: { fontFamily: theme.serif, fontSize: 28, color: colors.onSurface, marginTop: 4 },
  chatBody: { padding: 20, paddingBottom: 24, gap: 12 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyIcon: { width: 64, height: 64, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontFamily: theme.serif, fontSize: 24, color: colors.onSurface },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 32, paddingHorizontal: 24, lineHeight: 20 },
  suggestions: { gap: 10, width: '100%', paddingHorizontal: 8 },
  suggestion: { backgroundColor: colors.surfaceSecondary, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 4 },
  suggestionText: { fontSize: 14, color: colors.onSurface },
  bubble: { maxWidth: '82%', padding: 14, borderRadius: 12 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.brandTertiary, borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: colors.surfaceSecondary, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: colors.onBrandTertiary },
  aiText: { color: colors.onSurface },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: 10 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: 15, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 22 },
  sendBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
