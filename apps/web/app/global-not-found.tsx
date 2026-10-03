import { connection } from "next/server";
import "./globals.css";

export default async function GlobalNotFound() {
  await connection();
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
          <h1 className="text-4xl font-semibold tracking-tight">Page not found</h1>
        </main>
      </body>
    </html>
  );
}
