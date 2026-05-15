"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut, User } from "lucide-react";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  const { data: session } = useSession();

  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-6">
      {title && <h1 className="font-semibold text-lg">{title}</h1>}

      <div className="flex items-center gap-4 ml-auto">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="w-4 h-4" />
          <span>{session?.user?.name || session?.user?.email}</span>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          退出
        </button>
      </div>
    </header>
  );
}
