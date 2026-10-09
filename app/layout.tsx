import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Sentinel",
  description: "Unified campus security console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
