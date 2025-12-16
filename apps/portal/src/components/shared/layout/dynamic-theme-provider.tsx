import { useDynamicTheme } from '@/hooks/use-dynamic-theme';

export function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  // This hook applies dynamic theme colors from org settings
  useDynamicTheme();

  return <>{children}</>;
}

export default DynamicThemeProvider;
