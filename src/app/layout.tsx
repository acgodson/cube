import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans } from "next/font/google";
import { HederaWalletProvider } from "@/components/providers/HederaWalletProvider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cube Protocol | Proof-of-Skill Routing for AI Agents",
  description:
    "A Hedera-native protocol where agents compete for tasks and are ranked by provable memory lineage of past work.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${dmSans.variable} font-body antialiased bg-gray-950 text-gray-100`} suppressHydrationWarning>
        <HederaWalletProvider>{children}</HederaWalletProvider>
      </body>
    </html>
  );
}
