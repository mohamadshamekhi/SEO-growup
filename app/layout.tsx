import type { Metadata } from "next";
import "./globals.css";

// RTL + Vazirmatn, matching the Python app's public/index.html exactly (lang="fa" dir="rtl",
// same font). A tiny pre-paint inline script applies the saved theme before first render to
// avoid a flash, porting public/theme.js's one-liner approach as-is.
export const metadata: Metadata = {
  title: "Growth Hub",
  description: "پنل رشد فروش و سئو",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem('theme')||'dark'}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
