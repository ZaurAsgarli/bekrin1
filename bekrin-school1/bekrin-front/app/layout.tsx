import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/Providers";

export const metadata: Metadata = {
  title: "Bekrin School",
  description: "DIM imtahanına hazırlıq üçün kurs idarəetmə sistemi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // suppressHydrationWarning: extensions (e.g. Grammarly) inject data-* attrs; prefer disabling on localhost
  return (
    <html lang="az" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

