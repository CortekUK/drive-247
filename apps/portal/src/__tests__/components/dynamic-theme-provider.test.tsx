import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Regression cover for the "portal is down" incident.
 *
 * An operator loaded more-luxe-rentals.portal.drive-247.com instead of
 * moore-luxe-rentals (one character). No tenant matched, so this provider's
 * readiness condition — which requires a non-null `tenant` — could never become
 * true, and the page sat on a skeleton and a spinner indefinitely. They reported
 * it as a total outage on both mobile and desktop, on a busy evening, while the
 * platform was healthy and their own address worked.
 *
 * The rule these tests protect: once tenant resolution has FINISHED and produced
 * no tenant, the user must be told, not left watching a spinner.
 */

const mockUseTenant = vi.fn();
const mockUseTenantBranding = vi.fn();
const mockUseDynamicTheme = vi.fn();

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => mockUseTenant(),
}));
vi.mock('@/hooks/use-tenant-branding', () => ({
  useTenantBranding: () => mockUseTenantBranding(),
}));
vi.mock('@/hooks/use-dynamic-theme', () => ({
  useDynamicTheme: (options: unknown) => mockUseDynamicTheme(options),
}));

import { DynamicThemeProvider } from '@/components/shared/layout/dynamic-theme-provider';
import { V2Provider } from '@/lib/v2-context';

const CHILD = 'the-portal-content';

// `resolvedBranding` in the real hook is `branding || immediateFromTenant`, so it
// is always truthy. Mirroring that matters: it proves the null TENANT was the
// sole cause of the hang, not a missing branding row.
const BRANDING_LOADED = { isLoading: false, branding: { app_name: 'Moore Luxe' } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DynamicThemeProvider — unresolvable tenant', () => {
  it('shows an explanation instead of spinning forever on an unknown subdomain', () => {
    mockUseTenant.mockReturnValue({
      loading: false,
      tenant: null,
      error: 'Tenant "more-luxe-rentals" not found or inactive',
      tenantSlug: 'more-luxe-rentals',
    });
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    const { container } = render(
      <DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>
    );

    expect(screen.getByText(/couldn.t find a portal at this address/i)).toBeInTheDocument();
    // The precise failure this fixes: no spinner may remain on screen.
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('surfaces the underlying reason so support can act on it', () => {
    mockUseTenant.mockReturnValue({
      loading: false,
      tenant: null,
      error: 'Tenant "more-luxe-rentals" not found or inactive',
      tenantSlug: 'more-luxe-rentals',
    });
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    render(<DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>);

    expect(
      screen.getByText(/Tenant "more-luxe-rentals" not found or inactive/i)
    ).toBeInTheDocument();
  });

  it('reassures the operator that their data is intact', () => {
    // They escalated believing they had lost the platform mid-trade.
    mockUseTenant.mockReturnValue({
      loading: false, tenant: null, error: 'not found', tenantSlug: 'typo',
    });
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    render(<DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>);

    expect(screen.getByText(/account and your data are unaffected/i)).toBeInTheDocument();
  });

  it('handles no subdomain at all with different wording', () => {
    mockUseTenant.mockReturnValue({
      loading: false,
      tenant: null,
      error: 'No tenant detected. Please access portal via {tenant}.portal.drive-247.com',
      tenantSlug: null,
    });
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    render(<DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>);

    expect(screen.getByText(/No account name was found in the address/i)).toBeInTheDocument();
  });

  it('never lists other tenants, which would leak the customer list', () => {
    mockUseTenant.mockReturnValue({
      loading: false, tenant: null, error: 'not found', tenantSlug: 'more-luxe-rentals',
    });
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    const { container } = render(
      <DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>
    );

    // A "did you mean" is deliberately absent: answering it from an
    // unauthenticated page turns the portal into a confirmed customer directory.
    expect(container.textContent).not.toMatch(/did you mean/i);
    expect(container.textContent).not.toMatch(/moore-luxe-rentals/);
  });
});

describe('DynamicThemeProvider — normal operation is unchanged', () => {
  it('still shows the skeleton while resolution is genuinely in progress', () => {
    // TenantContext initialises `loading` to true, so this is the real startup
    // state and must NOT be mistaken for a failure.
    mockUseTenant.mockReturnValue({
      loading: true, tenant: null, error: null, tenantSlug: 'moore-luxe-rentals',
    });
    mockUseTenantBranding.mockReturnValue({ isLoading: true, branding: null });

    const { container } = render(
      <DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>
    );

    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText(/couldn.t find a portal/i)).toBeNull();
    expect(screen.queryByText(CHILD)).toBeNull();
  });

  it('renders the app once the tenant resolves', async () => {
    mockUseTenant.mockReturnValue({
      loading: false,
      tenant: { id: '1334709f', slug: 'moore-luxe-rentals', company_name: 'Moore Luxe' },
      error: null,
      tenantSlug: 'moore-luxe-rentals',
    });
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    render(<DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>);

    expect(await screen.findByText(CHILD)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t find a portal/i)).toBeNull();
  });
});

describe('DynamicThemeProvider — which theme path the hook takes', () => {
  const RESOLVED = {
    loading: false,
    tenant: { id: '1334709f', slug: 'northwind', company_name: 'Northwind' },
    error: null,
    tenantSlug: 'northwind',
  };

  it('asks for the v2 path when the server resolved the v2 theme', () => {
    // On v2 the brand colour must land on <body>, where `.v2-theme` lives;
    // v1's tokens on <html> are overridden by that class and never show.
    mockUseTenant.mockReturnValue(RESOLVED);
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    render(
      <V2Provider flags={{ theme: true }}>
        <DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>
      </V2Provider>
    );

    expect(mockUseDynamicTheme).toHaveBeenCalledWith({ v2Theme: true });
  });

  it('keeps every other tenant on the v1 path', () => {
    mockUseTenant.mockReturnValue(RESOLVED);
    mockUseTenantBranding.mockReturnValue(BRANDING_LOADED);

    // A tenant widened for the chrome but not the theme, and no provider at all.
    render(
      <V2Provider flags={{ chrome: true }}>
        <DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>
      </V2Provider>
    );
    render(<DynamicThemeProvider><div>{CHILD}</div></DynamicThemeProvider>);

    expect(mockUseDynamicTheme).toHaveBeenCalledWith({ v2Theme: false });
    expect(mockUseDynamicTheme).not.toHaveBeenCalledWith({ v2Theme: true });
  });
});
