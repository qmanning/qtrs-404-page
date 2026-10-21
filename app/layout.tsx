import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Q.T.R.S. 404 Page",
    description: "A 404 page you don't mind landing on: QBOT plays Tetris on a handheld, and you can take over.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body style={{ margin: 0 }}>{children}</body>
        </html>
    );
}
