import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, StyleSheet } from 'react-native';
import { FarmerDashboardScreen } from '../screens/farmer/FarmerDashboardScreen';
import { FarmerInvoicesScreen } from '../screens/farmer/FarmerInvoicesScreen';

const Tab = createBottomTabNavigator();

export function FarmerNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#0284c7',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="FarmerDashboard"
        component={FarmerDashboardScreen}
        options={{
          tabBarLabel: 'داشبورد دوره',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="FarmerInvoices"
        component={FarmerInvoicesScreen}
        options={{
          tabBarLabel: 'حواله‌ها و باسکول',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚖️</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    height: 60,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
  },
});

export default FarmerNavigator;
