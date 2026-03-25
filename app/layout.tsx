import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "推し活パスポート MVP",
  description: "来場・購入・視聴を記録し、応援履歴と運営分析を可視化",
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
