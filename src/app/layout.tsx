import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAP Policy Assistant",
  description: "Internal policy assistant for the Development Academy of the Philippines",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
