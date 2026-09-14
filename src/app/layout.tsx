import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RecoLab · Recommendation research",
  description: "Private, auditable recommendation research",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link className="brand" href="/">
            Reco<span>Lab</span>
          </Link>
          <nav>
            <Link href="/setup">Setup</Link>
            <Link href="/inbox">Inbox</Link>
            <Link href="/review">Review queue</Link>
            <Link href="/recommendations">Recommendations</Link>
          </nav>
          <span className="badge">LOCAL · PHASE 1</span>
        </header>
        <main>{children}</main>
        <footer>
          Private research workspace · Gmail read-only · No trade execution
        </footer>
      </body>
    </html>
  );
}
