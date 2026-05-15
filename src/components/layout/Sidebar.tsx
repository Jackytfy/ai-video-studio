"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, LayoutDashboard, Plus, Settings } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "项目列表", icon: LayoutDashboard },
  { href: "/", label: "新建项目", icon: Plus, isCreate: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 border-r border-border bg-sidebar flex flex-col h-screen sticky top-0">
      <div className="p-4 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Film className="w-6 h-6 text-purple" />
          <span className="font-bold text-lg">AI 视频</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-purple/10 text-purple"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <Link
          href="/settings"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            pathname === "/settings"
              ? "bg-purple/10 text-purple"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          <Settings className="w-4 h-4" />
          设置
        </Link>
      </div>
    </aside>
  );
}
