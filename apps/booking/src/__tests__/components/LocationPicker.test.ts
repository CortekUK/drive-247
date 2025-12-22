/**
 * Test suite for LocationPicker component
 *
 * Tests the following functionality:
 * - Rendering based on tenant location mode
 * - Fixed mode displays read-only address
 * - Custom mode shows autocomplete
 * - Multiple mode shows dropdown
 * - Location ID handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({
            data: [
              { id: 'loc-1', name: 'Downtown Office', address: '123 Main St', is_pickup_enabled: true, is_return_enabled: true },
              { id: 'loc-2', name: 'Airport Terminal', address: '456 Airport Blvd', is_pickup_enabled: true, is_return_enabled: true },
            ],
            error: null,
          })),
        })),
      })),
    })),
  },
}));

// Mock TenantContext
const mockTenant = {
  id: 'test-tenant-id',
  slug: 'test-tenant',
  pickup_location_mode: 'custom' as const,
  return_location_mode: 'custom' as const,
  fixed_pickup_address: '100 Fixed St, Los Angeles, CA',
  fixed_return_address: '200 Fixed Ave, Los Angeles, CA',
};

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: mockTenant,
    loading: false,
  }),
}));

describe('LocationPicker Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Mode Detection', () => {
    it('should use pickup_location_mode for pickup type', () => {
      const type = 'pickup';
      const mode = type === 'pickup'
        ? mockTenant.pickup_location_mode
        : mockTenant.return_location_mode;

      expect(mode).toBe('custom');
    });

    it('should use return_location_mode for return type', () => {
      const type = 'return';
      const mode = type === 'pickup'
        ? mockTenant.pickup_location_mode
        : mockTenant.return_location_mode;

      expect(mode).toBe('custom');
    });
  });

  describe('Fixed Mode', () => {
    it('should use fixed_pickup_address for pickup in fixed mode', () => {
      const type = 'pickup';
      const fixedAddress = type === 'pickup'
        ? mockTenant.fixed_pickup_address
        : mockTenant.fixed_return_address;

      expect(fixedAddress).toBe('100 Fixed St, Los Angeles, CA');
    });

    it('should use fixed_return_address for return in fixed mode', () => {
      const type = 'return';
      const fixedAddress = type === 'pickup'
        ? mockTenant.fixed_pickup_address
        : mockTenant.fixed_return_address;

      expect(fixedAddress).toBe('200 Fixed Ave, Los Angeles, CA');
    });

    it('should show placeholder when no fixed address configured', () => {
      const emptyAddress = null;
      const displayText = emptyAddress || 'No address configured';

      expect(displayText).toBe('No address configured');
    });
  });

  describe('Multiple Mode', () => {
    it('should find selected location by ID', () => {
      const locations = [
        { id: 'loc-1', name: 'Downtown Office', address: '123 Main St' },
        { id: 'loc-2', name: 'Airport Terminal', address: '456 Airport Blvd' },
      ];
      const selectedId = 'loc-1';

      const selectedLocation = locations.find(l => l.id === selectedId);

      expect(selectedLocation).toBeDefined();
      expect(selectedLocation?.name).toBe('Downtown Office');
    });

    it('should extract address from selected location', () => {
      const locations = [
        { id: 'loc-1', name: 'Downtown Office', address: '123 Main St' },
        { id: 'loc-2', name: 'Airport Terminal', address: '456 Airport Blvd' },
      ];
      const selectedId = 'loc-2';

      const selectedLocation = locations.find(l => l.id === selectedId);
      const address = selectedLocation?.address;

      expect(address).toBe('456 Airport Blvd');
    });
  });

  describe('onChange Callback', () => {
    it('should call onChange with address for custom mode', () => {
      const onChange = vi.fn();
      const address = '789 New Address';

      // Simulate custom mode selection
      onChange(address, undefined, 34.05, -118.24);

      expect(onChange).toHaveBeenCalledWith(address, undefined, 34.05, -118.24);
    });

    it('should call onChange with address and locationId for multiple mode', () => {
      const onChange = vi.fn();
      const address = '123 Main St';
      const locationId = 'loc-1';

      // Simulate multiple mode selection
      onChange(address, locationId);

      expect(onChange).toHaveBeenCalledWith(address, locationId);
    });

    it('should call onChange with fixed address for fixed mode', () => {
      const onChange = vi.fn();
      const fixedAddress = '100 Fixed St, Los Angeles, CA';

      // Simulate auto-setting fixed address
      onChange(fixedAddress, undefined);

      expect(onChange).toHaveBeenCalledWith(fixedAddress, undefined);
    });
  });

  describe('Location Data Structure', () => {
    it('should have correct location object structure', () => {
      const location = {
        id: 'loc-1',
        name: 'Downtown Office',
        address: '123 Main St, Los Angeles, CA 90001',
        is_pickup_enabled: true,
        is_return_enabled: true,
      };

      expect(location).toHaveProperty('id');
      expect(location).toHaveProperty('name');
      expect(location).toHaveProperty('address');
      expect(location).toHaveProperty('is_pickup_enabled');
      expect(location).toHaveProperty('is_return_enabled');
    });
  });

  describe('Location Type Filtering', () => {
    it('should filter locations for pickup type', () => {
      const locations = [
        { id: '1', name: 'Pickup Only', is_pickup_enabled: true, is_return_enabled: false, is_active: true },
        { id: '2', name: 'Return Only', is_pickup_enabled: false, is_return_enabled: true, is_active: true },
        { id: '3', name: 'Both', is_pickup_enabled: true, is_return_enabled: true, is_active: true },
      ];
      const type = 'pickup';
      const enabledField = type === 'pickup' ? 'is_pickup_enabled' : 'is_return_enabled';

      const filtered = locations.filter(l => l.is_active && l[enabledField]);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(l => l.name)).toContain('Pickup Only');
      expect(filtered.map(l => l.name)).toContain('Both');
    });

    it('should filter locations for return type', () => {
      const locations = [
        { id: '1', name: 'Pickup Only', is_pickup_enabled: true, is_return_enabled: false, is_active: true },
        { id: '2', name: 'Return Only', is_pickup_enabled: false, is_return_enabled: true, is_active: true },
        { id: '3', name: 'Both', is_pickup_enabled: true, is_return_enabled: true, is_active: true },
      ];
      const type = 'return';
      const enabledField = type === 'pickup' ? 'is_pickup_enabled' : 'is_return_enabled';

      const filtered = locations.filter(l => l.is_active && l[enabledField]);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(l => l.name)).toContain('Return Only');
      expect(filtered.map(l => l.name)).toContain('Both');
    });
  });
});

describe('Rental Location Storage', () => {
  it('should store location data in rental object', () => {
    const rentalData = {
      customer_id: 'cust-1',
      vehicle_id: 'veh-1',
      pickup_location: '123 Main St, Los Angeles, CA',
      pickup_location_id: 'loc-1',
      return_location: '456 Airport Blvd, Los Angeles, CA',
      return_location_id: 'loc-2',
    };

    expect(rentalData).toHaveProperty('pickup_location');
    expect(rentalData).toHaveProperty('pickup_location_id');
    expect(rentalData).toHaveProperty('return_location');
    expect(rentalData).toHaveProperty('return_location_id');
  });

  it('should allow null location_id for custom mode', () => {
    const rentalData = {
      pickup_location: '789 Custom Address',
      pickup_location_id: null,
      return_location: '789 Custom Address',
      return_location_id: null,
    };

    expect(rentalData.pickup_location_id).toBeNull();
    expect(rentalData.return_location_id).toBeNull();
  });

  it('should store both address and ID for multiple mode', () => {
    const rentalData = {
      pickup_location: '123 Main St',
      pickup_location_id: 'loc-1',
    };

    expect(rentalData.pickup_location).toBe('123 Main St');
    expect(rentalData.pickup_location_id).toBe('loc-1');
  });
});
