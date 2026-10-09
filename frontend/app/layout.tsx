import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "iLoveForms — Make it a conversation",
  description: "Thoughtful forms. Better conversations.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Browser extensions may add body attributes before React hydrates. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
