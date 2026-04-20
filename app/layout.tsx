export const metadata = { title: "Code Sandbox", description: "Multi-language code sandbox" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#1e1e1e", color: "#ddd", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
