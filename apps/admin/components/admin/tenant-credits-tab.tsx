'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';

interface CreditWallet {
  id: string;
  tenant_id: string;
  balance: number;
  test_balance: number;
  lifetime_purchased: number;
  lifetime_used: number;
  test_lifetime_purchased: number;
  test_lifetime_used: number;
  auto_refill_enabled: boolean;
  auto_refill_threshold: number;
  auto_refill_amount: number;
}

interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  category: string | null;
  description: string | null;
  is_test_mode: boolean;
  created_at: string;
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TenantCreditsTab({ tenantId }: { tenantId: string }) {
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustMode, setAdjustMode] = useState<'live' | 'test'>('live');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [walletRes, txRes] = await Promise.all([
      supabase.from('tenant_credit_wallets').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('credit_transactions').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100),
    ]);
    setWallet(walletRes.data);
    setTransactions(txRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  const handleAdjust = async () => {
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error('Enter a valid non-zero amount');
      return;
    }
    if (!adjustNote.trim()) {
      toast.error('A note/reason is required');
      return;
    }

    setAdjusting(true);
    try {
      const action = amount > 0 ? 'gift' : 'adjust';
      const { data, error } = await supabase.functions.invoke('manage-credit-wallet', {
        body: {
          action,
          tenantId,
          amount,
          note: adjustNote.trim(),
          isTestMode: adjustMode === 'test',
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`${amount > 0 ? 'Added' : 'Deducted'} ${Math.abs(amount)} ${adjustMode} credits`);
      setAdjustAmount('');
      setAdjustNote('');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to adjust credits');
    } finally {
      setAdjusting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-dark-card rounded-lg p-5 border border-dark-border">
          <p className="text-sm text-green-400 font-medium mb-1">Live Balance</p>
          <p className="text-3xl font-bold text-white">{wallet?.balance?.toFixed(0) ?? '0'}</p>
          <div className="mt-3 flex gap-4 text-xs text-dark-text-secondary">
            <span>Purchased: {wallet?.lifetime_purchased?.toFixed(0) ?? '0'}</span>
            <span>Used: {wallet?.lifetime_used?.toFixed(0) ?? '0'}</span>
          </div>
        </div>

        <div className="bg-dark-card rounded-lg p-5 border border-dark-border">
          <p className="text-sm text-yellow-400 font-medium mb-1">Test Balance</p>
          <p className="text-3xl font-bold text-white">{wallet?.test_balance?.toFixed(0) ?? '0'}</p>
          <div className="mt-3 flex gap-4 text-xs text-dark-text-secondary">
            <span>Purchased: {wallet?.test_lifetime_purchased?.toFixed(0) ?? '0'}</span>
            <span>Used: {wallet?.test_lifetime_used?.toFixed(0) ?? '0'}</span>
          </div>
        </div>
      </div>

      {/* Adjust Credits */}
      <div className="bg-dark-card rounded-lg p-5 border border-dark-border">
        <h3 className="text-lg font-semibold text-white mb-4">Adjust Credits</h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm text-dark-text-secondary mb-1">Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => setAdjustMode('live')}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  adjustMode === 'live'
                    ? 'bg-green-600 text-white'
                    : 'bg-dark-border text-dark-text-secondary hover:text-white'
                }`}
              >
                Live
              </button>
              <button
                onClick={() => setAdjustMode('test')}
                className={`px-3 py-1.5 rounded text-sm font-medium ${
                  adjustMode === 'test'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-dark-border text-dark-text-secondary hover:text-white'
                }`}
              >
                Test
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-dark-text-secondary mb-1">
              Amount (positive to add, negative to deduct)
            </label>
            <input
              type="number"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              placeholder="e.g. 100 or -50"
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm text-dark-text-secondary mb-1">Note/Reason *</label>
            <input
              type="text"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              placeholder="Reason for adjustment"
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            onClick={handleAdjust}
            disabled={adjusting}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50"
          >
            {adjusting ? 'Applying...' : 'Apply Adjustment'}
          </button>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-dark-card rounded-lg border border-dark-border">
        <div className="px-5 py-4 border-b border-dark-border">
          <h3 className="text-lg font-semibold text-white">Transaction History</h3>
          <p className="text-sm text-dark-text-secondary mt-0.5">Recent credit activity for this tenant</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-border">
                <th className="text-left py-2.5 px-4 text-xs font-semibold text-dark-text-secondary uppercase">Date</th>
                <th className="text-left py-2.5 px-4 text-xs font-semibold text-dark-text-secondary uppercase">Type</th>
                <th className="text-left py-2.5 px-4 text-xs font-semibold text-dark-text-secondary uppercase">Description</th>
                <th className="text-left py-2.5 px-4 text-xs font-semibold text-dark-text-secondary uppercase">Category</th>
                <th className="text-right py-2.5 px-4 text-xs font-semibold text-dark-text-secondary uppercase">Amount</th>
                <th className="text-right py-2.5 px-4 text-xs font-semibold text-dark-text-secondary uppercase">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-sm text-dark-text-secondary">
                    No transactions yet
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-dark-border last:border-0">
                    <td className="py-2.5 px-4 text-sm text-dark-text-secondary">
                      {formatDateTime(tx.created_at)}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="flex items-center gap-1.5">
                        <span className={`text-sm capitalize ${
                          tx.type === 'purchase' ? 'text-green-400' :
                          tx.type === 'usage' ? 'text-red-400' :
                          tx.type === 'refund' ? 'text-blue-400' :
                          tx.type === 'gift' ? 'text-purple-400' :
                          tx.type === 'auto_refill' ? 'text-amber-400' :
                          'text-dark-text-secondary'
                        }`}>
                          {tx.type.replace('_', '-')}
                        </span>
                        {tx.is_test_mode && (
                          <span className="text-[10px] px-1.5 py-0 rounded border border-orange-500/50 text-orange-400">TEST</span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-sm text-dark-text-secondary max-w-[250px] truncate">
                      {tx.description || '\u2014'}
                    </td>
                    <td className="py-2.5 px-4 text-sm text-dark-text-secondary capitalize">
                      {tx.category || '\u2014'}
                    </td>
                    <td className={`py-2.5 px-4 text-sm font-medium text-right ${
                      tx.amount > 0 ? 'text-green-400' : tx.amount < 0 ? 'text-red-400' : 'text-dark-text-secondary'
                    }`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount}
                    </td>
                    <td className="py-2.5 px-4 text-sm text-right text-dark-text-secondary">
                      {tx.balance_after}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
