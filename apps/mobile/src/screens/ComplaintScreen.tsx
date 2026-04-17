import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, Alert, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import TextInputField from '../components/TextInputField';
import ActionButton from '../components/ActionButton';
import { t } from '../copy/brandCopy';

const CATEGORIES = [
  { id: 'urun_kalitesi', labelKey: 'label.complaint.categoryQuality' as const, icon: 'fast-food-outline' as const },
  { id: 'teslimat_gecikmesi', labelKey: 'label.complaint.categoryDelivery' as const, icon: 'car-outline' as const },
  { id: 'yanlis_urun', labelKey: 'label.complaint.categoryWrongOrder' as const, icon: 'swap-horizontal-outline' as const },
  { id: 'ucret_iadesi', labelKey: 'label.complaint.categoryRefund' as const, icon: 'cash-outline' as const },
];

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onCreated?: (ticket: { id: string; ticketNo: number }) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function ComplaintScreen({ auth, orderId, onBack, onCreated, onAuthRefresh }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!selectedCategory) {
      Alert.alert(t('error.complaint.categoryRequiredTitle'), t('error.complaint.categoryRequiredMessage'));
      return;
    }
    if (description.trim().length < 10) {
      Alert.alert(t('error.complaint.descriptionRequiredTitle'), t('error.complaint.descriptionRequiredMessage'));
      return;
    }
    setSubmitting(true);
    const result = await apiRequest<{ id: string; ticketNo: number }>(
      '/v1/complaints/',
      auth,
      {
        method: 'POST',
        body: {
          orderId,
          category: selectedCategory,
          description: description.trim(),
        },
        actorRole: 'buyer',
      },
      onAuthRefresh,
    );
    setSubmitting(false);
    if (result.ok) {
      onCreated?.({ id: result.data.id, ticketNo: result.data.ticketNo ?? 0 });
      setSubmitted(true);
    } else {
      Alert.alert(t('headline.common.error'), result.message ?? t('error.complaint.submit'));
    }
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title={t('headline.complaint.title')} onBack={onBack} />
        <View style={styles.successCenter}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#3E845B" />
          </View>
          <Text style={styles.successTitle}>{t('headline.complaint.submittedTitle')}</Text>
          <Text style={styles.successSub}>{t('helper.complaint.submittedSubtitle')}</Text>
          <ActionButton label={t('cta.common.goBack')} onPress={onBack} variant="primary" />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.complaint.createTitle')} onBack={onBack} />

      <ScrollView
        style={styles.contentScroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Category Selection */}
        <Text style={styles.sectionTitle}>{t('headline.complaint.categoryTitle')}</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => {
            const selected = selectedCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryCard, selected && styles.categoryCardSelected]}
                activeOpacity={0.7}
                onPress={() => setSelectedCategory(cat.id)}
              >
                <View style={[styles.categoryIcon, selected && styles.categoryIconSelected]}>
                  <Ionicons name={cat.icon} size={22} color={selected ? '#FFFFFF' : '#71685F'} />
                </View>
                <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}>
                  {t(cat.labelKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Description */}
        <View style={styles.descCard}>
          <TextInputField
            label={t('helper.complaint.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            placeholder={t('helper.complaint.descriptionPlaceholder')}
            multiline
            numberOfLines={5}
            maxLength={2000}
          />
        </View>

      </ScrollView>

      <View style={styles.footer}>
        <ActionButton
          label={t('cta.complaint.submit')}
          onPress={handleSubmit}
          loading={submitting}
          disabled={!selectedCategory || description.trim().length < 10}
          variant="primary"
          fullWidth
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  contentScroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 20 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: theme.background,
    borderTopWidth: 1,
    borderTopColor: '#ECE4D9',
  },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  categoryCard: {
    width: '47%',
    backgroundColor: '#FCFBF9',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 14,
    alignItems: 'center',
    gap: 8,
  },
  categoryCardSelected: { borderColor: theme.primary, backgroundColor: '#F0F7F2' },
  categoryIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F0ECE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconSelected: { backgroundColor: theme.primary },
  categoryLabel: { color: '#71685F', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  categoryLabelSelected: { color: theme.primary, fontWeight: '700' },
  descCard: {
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
    marginBottom: 16,
  },
  successCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#E4F2E7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: { color: theme.text, fontSize: 22, fontWeight: '800' },
  successSub: { color: '#71685F', fontSize: 14, marginBottom: 12 },
});
