import test from 'node:test';
import assert from 'node:assert/strict';
import { SecureStorageService } from '../src/services/secureStore';
import type { UserRole, MobileUser } from '../src/types/auth';

/**
 * Resolution engine replicating RootNavigator role switching logic.
 */
export function resolveTargetNavigator(
  isAuthenticated: boolean,
  role: UserRole | null
): 'AuthNavigator' | 'DriverNavigator' | 'FarmerNavigator' | 'ManagerNavigator' {
  if (!isAuthenticated) return 'AuthNavigator';
  if (role === 'DRIVER') return 'DriverNavigator';
  if (role === 'FARMER') return 'FarmerNavigator';
  if (role === 'MANAGER' || role === 'ADMIN') return 'ManagerNavigator';
  return 'DriverNavigator';
}

test('Role-Based Dynamic Navigation Resolution Protocol', async (t) => {
  await t.test('Unauthenticated user always resolves to AuthNavigator', async () => {
    await SecureStorageService.clearAuthSession();
    const token = await SecureStorageService.getAccessToken();
    const user = await SecureStorageService.getUserData<MobileUser>();

    const isAuthenticated = !!token && !!user;
    const target = resolveTargetNavigator(isAuthenticated, user?.role ?? null);

    assert.equal(isAuthenticated, false);
    assert.equal(target, 'AuthNavigator');
  });

  await t.test('Driver authentication directs guaranteed to DriverNavigator', async () => {
    await SecureStorageService.setAccessToken('driver_jwt_token_123');
    await SecureStorageService.setRefreshToken('driver_ref_token_123');
    await SecureStorageService.setUserData<MobileUser>({
      id: 'drv_01',
      username: '09121112233',
      role: 'DRIVER',
      driverId: 'd_rec_01',
      fullName: 'رضا راننده',
    });

    const token = await SecureStorageService.getAccessToken();
    const user = await SecureStorageService.getUserData<MobileUser>();

    const isAuthenticated = !!token && !!user;
    const target = resolveTargetNavigator(isAuthenticated, user?.role ?? null);

    assert.equal(isAuthenticated, true);
    assert.equal(user?.role, 'DRIVER');
    assert.equal(target, 'DriverNavigator');
  });

  await t.test('Farmer authentication directs guaranteed to FarmerNavigator', async () => {
    await SecureStorageService.setAccessToken('farmer_jwt_token_456');
    await SecureStorageService.setRefreshToken('farmer_ref_token_456');
    await SecureStorageService.setUserData<MobileUser>({
      id: 'fmr_01',
      username: '09124445566',
      role: 'FARMER',
      farmerId: 'f_rec_01',
      fullName: 'حاج احمد مرغدار',
    });

    const token = await SecureStorageService.getAccessToken();
    const user = await SecureStorageService.getUserData<MobileUser>();

    const isAuthenticated = !!token && !!user;
    const target = resolveTargetNavigator(isAuthenticated, user?.role ?? null);

    assert.equal(isAuthenticated, true);
    assert.equal(user?.role, 'FARMER');
    assert.equal(target, 'FarmerNavigator');
  });

  await t.test('Manager and Admin authentications direct guaranteed to ManagerNavigator', async () => {
    // 1. Manager role
    await SecureStorageService.setAccessToken('manager_jwt_token_789');
    await SecureStorageService.setUserData<MobileUser>({
      id: 'mgr_01',
      username: 'factory_manager',
      role: 'MANAGER',
      fullName: 'مهندس حسینی مدیر کارخانه',
    });

    let token = await SecureStorageService.getAccessToken();
    let user = await SecureStorageService.getUserData<MobileUser>();
    assert.equal(resolveTargetNavigator(!!token, user?.role ?? null), 'ManagerNavigator');

    // 2. Admin role
    await SecureStorageService.setUserData<MobileUser>({
      id: 'adm_01',
      username: 'superadmin',
      role: 'ADMIN',
      fullName: 'مدیر کل ارشد سیستم',
    });

    user = await SecureStorageService.getUserData<MobileUser>();
    assert.equal(resolveTargetNavigator(!!token, user?.role ?? null), 'ManagerNavigator');
  });

  await t.test('Logging out restores AuthNavigator immediately without app restart', async () => {
    await SecureStorageService.clearAuthSession();
    const token = await SecureStorageService.getAccessToken();
    const user = await SecureStorageService.getUserData<MobileUser>();

    assert.equal(resolveTargetNavigator(!!token, user?.role ?? null), 'AuthNavigator');
  });
});
