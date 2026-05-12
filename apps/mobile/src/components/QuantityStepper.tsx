import React from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type QuantityStepperProps = {
  value: number;
  onIncrease: () => void;
  onDecrease: () => void;
  iconSize?: number;
  iconColor?: string;
  containerStyle?: StyleProp<ViewStyle>;
  buttonStyle?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
};

export function QuantityStepper({
  value,
  onIncrease,
  onDecrease,
  iconSize = 14,
  iconColor = '#5F5246',
  containerStyle,
  buttonStyle,
  valueStyle,
  disabled = false,
}: QuantityStepperProps) {
  return (
    <View style={containerStyle}>
      <TouchableOpacity
        style={buttonStyle}
        onPress={onDecrease}
        activeOpacity={0.85}
        disabled={disabled}
      >
        <Ionicons name="remove" size={iconSize} color={iconColor} />
      </TouchableOpacity>
      <Text style={valueStyle}>{value}</Text>
      <TouchableOpacity
        style={buttonStyle}
        onPress={onIncrease}
        activeOpacity={0.85}
        disabled={disabled}
      >
        <Ionicons name="add" size={iconSize} color={iconColor} />
      </TouchableOpacity>
    </View>
  );
}
