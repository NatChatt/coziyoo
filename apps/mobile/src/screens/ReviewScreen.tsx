import React, { useState } from 'react';
import { View, Text, StyleSheet, StatusBar, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import StarRating from '../components/StarRating';
import TextInputField from '../components/TextInputField';
import ActionButton from '../components/ActionButton';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../copy/brandCopy';

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function ReviewScreen({ auth, orderId, onBack, onAuthRefresh }: Props) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (rating === 0) {
      Alert.alert(t('error.review.ratingRequiredTitle'), t('error.review.ratingRequiredMessage'));
      return;
    }
    setSubmitting(true);
    const result = await apiRequest(
      `/v1/orders/${orderId}/review`,
      auth,
      {
        method: 'POST',
        body: { rating, comment: comment.trim() || undefined },
        actorRole: 'buyer',
      },
      onAuthRefresh,
    );
    setSubmitting(false);
    if (result.ok) {
      setSubmitted(true);
    } else {
      Alert.alert(t('headline.common.error'), result.message ?? t('error.review.submit'));
    }
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title={t('headline.review.title')} onBack={onBack} />
        <View style={styles.successCenter}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#3E845B" />
          </View>
          <Text style={styles.successTitle}>{t('headline.review.submittedTitle')}</Text>
          <Text style={styles.successSub}>{t('helper.review.submittedSubtitle')}</Text>
          <ActionButton label={t('cta.common.goBack')} onPress={onBack} variant="primary" />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={0}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title={t('headline.review.createTitle')} onBack={onBack} />

      <View style={styles.content}>
        {/* Rating */}
        <View style={styles.ratingCard}>
          <Text style={styles.ratingLabel}>{t('helper.review.ratingLabel')}</Text>
          <StarRating rating={rating} onChange={setRating} size={40} />
          <Text style={styles.ratingHint}>
            {rating === 0
              ? t('helper.review.ratingHintEmpty')
              : rating <= 2
                ? t('helper.review.ratingHintBad')
                : rating <= 3
                  ? t('helper.review.ratingHintOkay')
                  : rating <= 4
                    ? t('helper.review.ratingHintGood')
                    : t('helper.review.ratingHintGreat')}
          </Text>
        </View>

        {/* Comment */}
        <View style={styles.commentCard}>
          <TextInputField
            label={t('helper.review.commentLabel')}
            value={comment}
            onChangeText={setComment}
            placeholder={t('helper.review.commentPlaceholder')}
            multiline
            numberOfLines={4}
            maxLength={1000}
          />
        </View>
      </View>

      <View style={styles.footer}>
        <ActionButton
          label={t('cta.review.submit')}
          onPress={handleSubmit}
          loading={submitting}
          disabled={rating === 0}
          variant="primary"
          fullWidth
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { flex: 1, padding: 16, gap: 16 },
  footer: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8, backgroundColor: theme.background },
  ratingCard: {
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  ratingLabel: { color: theme.text, fontSize: 18, fontWeight: '700', marginBottom: 16 },
  ratingHint: { color: theme.textSecondary, fontSize: 14, marginTop: 10 },
  commentCard: {
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
