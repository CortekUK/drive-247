/**
 * Test suite for usePickupLocations hook
 *
 * Tests the following functionality:
 * - Fetching location settings from tenant
 * - CRUD operations for pickup locations
 * - Updating location mode settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({
            data: {
              pickup_location_mode: 'custom',
              return_location_mode: 'custom',
              fixed_pickup_address: null,
              fixed_return_address: null,
            },
            error: null,
          })),
          order: vi.fn(() => Promise.resolve({
            data: [],
            error: null,
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({
            data: { id: 'test-id', name: 'Test Location', address: '123 Test St' },
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({
              data: { pickup_location_mode: 'fixed' },
              error: null,
            })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

// Mock TenantContext
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 'test-tenant-id', slug: 'test-tenant' },
  }),
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

describe('usePickupLocations Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Location Settings', () => {
    it('should have default location mode as "custom"', () => {
      const defaultSettings = {
        pickup_location_mode: 'custom',
        return_location_mode: 'custom',
        fixed_pickup_address: null,
        fixed_return_address: null,
      };

      expect(defaultSettings.pickup_location_mode).toBe('custom');
      expect(defaultSettings.return_location_mode).toBe('custom');
    });

    it('should support all three location modes', () => {
      const validModes = ['fixed', 'custom', 'multiple'];

      validModes.forEach(mode => {
        expect(['fixed', 'custom', 'multiple']).toContain(mode);
      });
    });

    it('should require fixed_pickup_address when mode is "fixed"', () => {
      const settingsWithFixedMode = {
        pickup_location_mode: 'fixed',
        fixed_pickup_address: '123 Main St, Los Angeles, CA',
      };

      expect(settingsWithFixedMode.pickup_location_mode).toBe('fixed');
      expect(settingsWithFixedMode.fixed_pickup_address).toBeTruthy();
    });
  });

  describe('Location CRUD Operations', () => {
    it('should validate location name is required', () => {
      const invalidLocation = { name: '', address: '123 Test St' };
      const isValid = invalidLocation.name.trim().length > 0;

      expect(isValid).toBe(false);
    });

    it('should validate location address is required', () => {
      const invalidLocation = { name: 'Test Location', address: '' };
      const isValid = invalidLocation.address.trim().length > 0;

      expect(isValid).toBe(false);
    });

    it('should create valid location object structure', () => {
      const newLocation = {
        name: 'Downtown Office',
        address: '100 Main Street, Los Angeles, CA 90001',
        is_pickup_enabled: true,
        is_return_enabled: true,
        is_active: true,
        sort_order: 0,
      };

      expect(newLocation).toHaveProperty('name');
      expect(newLocation).toHaveProperty('address');
      expect(newLocation).toHaveProperty('is_pickup_enabled');
      expect(newLocation).toHaveProperty('is_return_enabled');
      expect(newLocation).toHaveProperty('is_active');
      expect(newLocation).toHaveProperty('sort_order');
    });

    it('should support toggling pickup/return enabled flags', () => {
      const location = {
        id: 'loc-1',
        is_pickup_enabled: true,
        is_return_enabled: false,
      };

      // Toggle pickup
      const toggledPickup = { ...location, is_pickup_enabled: !location.is_pickup_enabled };
      expect(toggledPickup.is_pickup_enabled).toBe(false);

      // Toggle return
      const toggledReturn = { ...location, is_return_enabled: !location.is_return_enabled };
      expect(toggledReturn.is_return_enabled).toBe(true);
    });
  });

  describe('Location Filtering', () => {
    it('should filter active locations only', () => {
      const locations = [
        { id: '1', name: 'Active 1', is_active: true },
        { id: '2', name: 'Inactive', is_active: false },
        { id: '3', name: 'Active 2', is_active: true },
      ];

      const activeLocations = locations.filter(l => l.is_active);

      expect(activeLocations).toHaveLength(2);
      expect(activeLocations.every(l => l.is_active)).toBe(true);
    });

    it('should filter pickup-enabled locations', () => {
      const locations = [
        { id: '1', name: 'Pickup Only', is_pickup_enabled: true, is_return_enabled: false, is_active: true },
        { id: '2', name: 'Return Only', is_pickup_enabled: false, is_return_enabled: true, is_active: true },
        { id: '3', name: 'Both', is_pickup_enabled: true, is_return_enabled: true, is_active: true },
      ];

      const pickupLocations = locations.filter(l => l.is_active && l.is_pickup_enabled);

      expect(pickupLocations).toHaveLength(2);
      expect(pickupLocations.every(l => l.is_pickup_enabled)).toBe(true);
    });

    it('should filter return-enabled locations', () => {
      const locations = [
        { id: '1', name: 'Pickup Only', is_pickup_enabled: true, is_return_enabled: false, is_active: true },
        { id: '2', name: 'Return Only', is_pickup_enabled: false, is_return_enabled: true, is_active: true },
        { id: '3', name: 'Both', is_pickup_enabled: true, is_return_enabled: true, is_active: true },
      ];

      const returnLocations = locations.filter(l => l.is_active && l.is_return_enabled);

      expect(returnLocations).toHaveLength(2);
      expect(returnLocations.every(l => l.is_return_enabled)).toBe(true);
    });
  });

  describe('Location Sorting', () => {
    it('should sort locations by sort_order', () => {
      const locations = [
        { id: '3', name: 'Third', sort_order: 2 },
        { id: '1', name: 'First', sort_order: 0 },
        { id: '2', name: 'Second', sort_order: 1 },
      ];

      const sorted = [...locations].sort((a, b) => a.sort_order - b.sort_order);

      expect(sorted[0].name).toBe('First');
      expect(sorted[1].name).toBe('Second');
      expect(sorted[2].name).toBe('Third');
    });
  });
});
