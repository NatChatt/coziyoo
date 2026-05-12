import React from 'react';
import { Text, TouchableOpacity, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ProfileMenuItemProps = {
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  iconBgColor: string;
  iconSize?: number;
  title: string;
  subtitle?: string;
  onPress: () => void;
  rowStyle?: StyleProp<ViewStyle>;
  iconWrapStyle?: StyleProp<ViewStyle>;
  mainStyle?: StyleProp<ViewStyle>;
  textBlockStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  chevronColor?: string;
  chevronSize?: number;
};

export function ProfileMenuItem({
  iconName,
  iconColor,
  iconBgColor,
  iconSize = 18,
  title,
  subtitle,
  onPress,
  rowStyle,
  iconWrapStyle,
  mainStyle,
  textBlockStyle,
  titleStyle,
  subtitleStyle,
  chevronColor = '#A79B8E',
  chevronSize = 18,
}: ProfileMenuItemProps) {
  return (
    <TouchableOpacity style={rowStyle} onPress={onPress} activeOpacity={0.85}>
      <View style={mainStyle}>
        <View style={[iconWrapStyle, { backgroundColor: iconBgColor }]}>
          <Ionicons name={iconName} size={iconSize} color={iconColor} />
        </View>
        {subtitle ? (
          <View style={textBlockStyle}>
            <Text style={titleStyle}>{title}</Text>
            <Text style={subtitleStyle}>{subtitle}</Text>
          </View>
        ) : (
          <Text style={titleStyle}>{title}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={chevronSize} color={chevronColor} />
    </TouchableOpacity>
  );
}
