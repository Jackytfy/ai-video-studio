"use client";

import { User } from "lucide-react";

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-6">
      {title && <h1 className="font-semibold text-lg">{title}</h1>}

      <div className="flex items-center gap-4 ml-auto">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="w-4 h-4" />
          <span>默认用户</span>
        </div>
      </div>
    </header>
  );
}
