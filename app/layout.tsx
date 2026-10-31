import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Índice API | GraphQL e busca textual",
  description:
    "Documentos persistidos com GraphQL Yoga, SQLite FTS5 e controle de revisão.",
  metadataBase: new URL("https://indice-api-gustapaz.starrylinen.chatgpt.site"),
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg" },
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
