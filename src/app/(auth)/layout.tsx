import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "登录 - AI视频创作平台",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-gradient-to-b from-purple/5 via-transparent to-transparent pointer-events-none" />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
