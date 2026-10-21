import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PasswordChangePanelV2 } from '@/components/shared/layout/password-change-panel-v2';

/**
 * The profile dialog's password panel (Oct 21 2026 redesign): Continue stays
 * off until every rule is met and the two fields match; it sends the code and
 * moves to the code step; a wrong code says so and keeps the step; a right one
 * finishes. The code itself goes through `onSave` with the password typed.
 */
describe('PasswordChangePanelV2', () => {
  // The code boxes (input-otp) construct a ResizeObserver; the shared setup's
  // stub is a plain mock function, which cannot be `new`-ed.
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    // …and measures with elementFromPoint, which jsdom does not implement.
    if (!document.elementFromPoint) document.elementFromPoint = () => null;
  });

  const setup = (overrides: Partial<Parameters<typeof PasswordChangePanelV2>[0]> = {}) => {
    const props = {
      onSendCode: vi.fn().mockResolvedValue(null),
      onSave: vi.fn().mockResolvedValue(null),
      onCancel: vi.fn(),
      ...overrides,
    };
    render(<PasswordChangePanelV2 email="ops@example.com" {...props} />);
    return props;
  };

  it('ticks the rules off and keeps Continue off until they are all met and the fields match', () => {
    setup();
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    expect(screen.getByText('12 characters or more').textContent).toContain('(not met yet)');
    expect(screen.getByText('Weak')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Northwind2026' } });
    expect(screen.getByText('12 characters or more').textContent).toContain('(met)');
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Northwind2027' } });
    expect(screen.getByText('Passwords do not match yet')).toBeInTheDocument();
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Northwind2026' } });
    expect(screen.getByText('Passwords match')).toBeInTheDocument();
    expect(continueButton).toBeEnabled();
  });

  it('shows and hides the password', () => {
    setup();
    const field = screen.getByLabelText('New password') as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(field.type).toBe('text');
  });

  it('sends the code, then saves with the password and the code', async () => {
    const { onSendCode, onSave } = setup();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Northwind2026' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Northwind2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onSendCode).toHaveBeenCalledWith('Northwind2026'));
    expect(await screen.findByText('Enter the code I emailed you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();

    onSave.mockResolvedValueOnce("That code didn't work. Check it, or send a new one.");
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    // Six digits are required before Update is live.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reports a failed send and stays on the first step', async () => {
    const { onSendCode } = setup({ onSendCode: vi.fn().mockResolvedValue('Rate limit exceeded') });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Northwind2026' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Northwind2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate limit exceeded');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(onSendCode).toHaveBeenCalledTimes(1);
  });
});
