import "./globals.css";

export const metadata = { title: "Code Sandbox", description: "Multi-language code sandbox" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
