import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { Header } from "@/components/shared/Header";
import { SessionLoader } from "@/components/auth/SessionLoader";
import { Toaster } from "@/components/shared/Toast";
import { WhatsAppButton } from "@/components/shared/WhatsAppButton";
import { Footer } from "@/components/Footer";
import "@/styles/globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "AFriTech",
  description: "Shop electronics delivered anywhere in Ghana",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${poppins.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SessionLoader />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <Toaster />
        <WhatsAppButton />
      </body>
    </html>
  );
}