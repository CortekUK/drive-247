// Centralized formatting utilities that respect org settings

import { format } from 'date-fns';

// Default values when settings are not available
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_DATE_FORMAT = 'MM/DD/YYYY';
const DEFAULT_TIMEZONE = 'America/New_York';

// Currency formatting
export const formatCurrency = (
  amount: number | null | undefined, 
  currencyCode: string = DEFAULT_CURRENCY
): string => {
  if (amount === null || amount === undefined) return '$0.00';

  const currencySymbols: Record<string, string> = {
    USD: '$',
    GBP: '£',
    EUR: '€',
  };

  const symbol = currencySymbols[currencyCode] || '$';
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${symbol}${formatter.format(Math.abs(amount))}`;
};

// Date formatting
export const formatDate = (
  date: Date | string | null | undefined,
  dateFormat: string = DEFAULT_DATE_FORMAT
): string => {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '';

  // Convert our format tokens to date-fns format
  const formatMap: Record<string, string> = {
    'DD/MM/YYYY': 'dd/MM/yyyy',
    'MM/DD/YYYY': 'MM/dd/yyyy',
    'YYYY-MM-DD': 'yyyy-MM-dd',
  };

  const dateFnsFormat = formatMap[dateFormat] || formatMap[DEFAULT_DATE_FORMAT];
  
  try {
    return format(dateObj, dateFnsFormat);
  } catch (error) {
    console.error('Date formatting error:', error);
    return dateObj.toLocaleDateString();
  }
};

// Date and time formatting
export const formatDateTime = (
  date: Date | string | null | undefined,
  dateFormat: string = DEFAULT_DATE_FORMAT,
  includeTime: boolean = true
): string => {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '';

  const formatMap: Record<string, string> = {
    'DD/MM/YYYY': 'dd/MM/yyyy',
    'MM/DD/YYYY': 'MM/dd/yyyy',
    'YYYY-MM-DD': 'yyyy-MM-dd',
  };

  const dateFnsFormat = formatMap[dateFormat] || formatMap[DEFAULT_DATE_FORMAT];
  const fullFormat = includeTime ? `${dateFnsFormat} HH:mm` : dateFnsFormat;
  
  try {
    return format(dateObj, fullFormat);
  } catch (error) {
    console.error('DateTime formatting error:', error);
    return dateObj.toLocaleString();
  }
};

// Relative date formatting (e.g., "2 days ago", "in 3 days")
export const formatRelativeDate = (date: Date | string | null | undefined): string => {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '';

  const now = new Date();
  const diffInDays = Math.floor((dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Tomorrow';
  if (diffInDays === -1) return 'Yesterday';
  if (diffInDays > 1) return `In ${diffInDays} days`;
  if (diffInDays < -1) return `${Math.abs(diffInDays)} days ago`;

  return formatDate(dateObj);
};

// Percentage formatting
export const formatPercentage = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0%';
  return `${value.toFixed(1)}%`;
};

// Number formatting with thousands separators
export const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('en-US').format(value);
};

// Status badge variant mapping
export const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  const statusLower = status.toLowerCase();
  
  if (['active', 'completed', 'paid', 'applied'].includes(statusLower)) return 'default';
  if (['pending', 'partial', 'credit'].includes(statusLower)) return 'secondary';
  if (['overdue', 'failed', 'expired', 'open'].includes(statusLower)) return 'destructive';
  
  return 'outline';
};