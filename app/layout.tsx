import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "動画ツール",
  description: "ブラウザで動画を分割・結合",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

