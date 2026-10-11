import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, StyleSheet } from 'react-native';
import { ManagerKpiScreen } from '../screens/manager/ManagerKpiScreen';
import { RemittancesScreen } from '../screens/manager/RemittancesScreen';
import { WeighbridgeMonitorScreen } from '../screens/manager/WeighbridgeMonitorScreen';
import { InventoryMonitorScreen } from '../screens/manager/InventoryMonitorScreen';
import { MoreMenuScreen } from '../screens/manager/MoreMenuScreen';
import { FarmersDirectoryScreen } from '../screens/manager/FarmersDirectoryScreen';
import { ApprovalsScreen } from '../screens/manager/ApprovalsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ManagerTabs() {
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
        name="ManagerKpi"
        component={ManagerKpiScreen}
        options={{
          tabBarLabel: 'شاخص‌ها',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📈</Text>,
        }}
      />
      <Tab.Screen
        name="Remittances"
        component={RemittancesScreen}
        options={{
          tabBarLabel: 'حواله‌ها',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📋</Text>,
        }}
      />
      <Tab.Screen
        name="WeighbridgeMonitor"
        component={WeighbridgeMonitorScreen}
        options={{
          tabBarLabel: 'باسکول',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚖️</Text>,
        }}
      />
      <Tab.Screen
        name="InventoryMonitor"
        component={InventoryMonitorScreen}
        options={{
          tabBarLabel: 'انبار و سیلو',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🏭</Text>,
        }}
      />
      <Tab.Screen
        name="MoreMenu"
        component={MoreMenuScreen}
        options={{
          tabBarLabel: 'امکانات بیشتر',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>☰</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

export function ManagerNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_left',
      }}
    >
      <Stack.Screen name="ManagerTabsRoot" component={ManagerTabs} />
      <Stack.Screen name="FarmersDirectory" component={FarmersDirectoryScreen} />
      <Stack.Screen name="Approvals" component={ApprovalsScreen} />
    </Stack.Navigator>
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

export default ManagerNavigator;
