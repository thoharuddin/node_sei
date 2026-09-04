import './globals.css';
import { AuthProvider } from '../lib/auth';

export const metadata = {
  title: 'Stock Opname System',
  description: 'Physical inventory audit — products, stock, audit programs and approvals',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
