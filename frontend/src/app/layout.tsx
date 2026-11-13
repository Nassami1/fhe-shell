import type { Metadata } from "next";
import { Providers } from "@/providers";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mystery Box Showdown",
  description: "Private power. Public odds. The highest encrypted score takes the pot.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <WalletProvider>
          <Providers>{children}</Providers>
        </WalletProvider>
      </body>
    </html>
  );
}
