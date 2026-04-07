import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionButton from './ActionButton';
import { theme } from '../theme/colors';
import { t } from '../copy/brandCopy';

type Props = {
  message: string;
  onRetry?: () => void;
};

export default function ErrorState({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.error} />
      </View>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <View style={styles.actionWrap}>
          <ActionButton label={t('cta.common.retry')} onPress={onRetry} variant="soft" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  iconWrap: { marginBottom: 12 },
  message: { color: theme.text, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  actionWrap: { marginTop: 20 },
});
