import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import { demoConfig } from "@/lib/config";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: `${demoConfig.appName} | Demo`,
  description:
    "Demo em Next.js de triagem conversacional e agendamento odontológico com contexto local e agenda em memória.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${sans.variable} ${display.variable}`}>{children}</body>
    </html>
  );
}
