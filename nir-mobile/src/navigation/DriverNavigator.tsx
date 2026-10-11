import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DriverLoadsScreen } from '../screens/driver/DriverLoadsScreen';
import { LoadDetailScreen } from '../screens/driver/LoadDetailScreen';
import { DeliveryProofScreen } from '../screens/driver/DeliveryProofScreen';

const Stack = createNativeStackNavigator();

export function DriverNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_left',
      }}
    >
      <Stack.Screen name="DriverLoads" component={DriverLoadsScreen} />
      <Stack.Screen name="LoadDetail" component={LoadDetailScreen} />
      <Stack.Screen name="DeliveryProof" component={DeliveryProofScreen} />
    </Stack.Navigator>
  );
}

export default DriverNavigator;
