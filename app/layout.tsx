import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Control de Asistencia — Backend",
  description: "API de checadas del Control de Asistencia.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
