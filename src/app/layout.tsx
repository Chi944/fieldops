import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import "./refinements.css";
import "@/components/review-polish.css";
import "@/components/personal-workspace.css";

export const metadata: Metadata = {
  title: "FieldOps — Every quote, a clearer decision",
  description: "An evidence-led workspace for comparing supplier quotations. Review the source, compare like for like, and make a defensible decision.",
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body>{children}</body></html>;
}
