"use client";

import { Film, Wand2 } from "lucide-react";

interface PlanSelectorProps {
  suggestedPlan: "A" | "B";
  onSelect: (plan: "A" | "B") => void;
  isLoading?: boolean;
}

export function PlanSelector({
  suggestedPlan,
  onSelect,
  isLoading,
}: PlanSelectorProps) {
  const plans = [
    {
      id: "A" as const,
      title: "方案 A",
      subtitle: "素材剪辑成片",
      description: "使用实拍素材（历史影像、纪录片片段、实景拍摄）进行剪辑",
      icon: Film,
      recommended: suggestedPlan === "A",
    },
    {
      id: "B" as const,
      title: "方案 B",
      subtitle: "素材 + MG 动画",
      description: "混合使用实拍素材和 MG 动画（图形动画、数据可视化、概念动画）",
      icon: Wand2,
      recommended: suggestedPlan === "B",
    },
  ];

  return (
    <div className="space-y-3 max-w-lg">
      <p className="text-sm text-muted-foreground">
        请选择制作方案，AI 将根据方案生成分镜脚本：
      </p>
      <div className="grid grid-cols-2 gap-3">
        {plans.map((plan) => {
          const Icon = plan.icon;
          return (
            <button
              key={plan.id}
              onClick={() => onSelect(plan.id)}
              disabled={isLoading}
              className={`bg-card border rounded-xl p-4 text-left transition-all hover:border-purple/50 disabled:opacity-50 ${
                plan.recommended
                  ? "border-purple/30 ring-1 ring-purple/20"
                  : "border-border"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 text-purple" />
                <span className="font-medium text-sm">{plan.title}</span>
                {plan.recommended && (
                  <span className="text-[10px] bg-purple/10 text-purple px-1.5 py-0.5 rounded-full">
                    推荐
                  </span>
                )}
              </div>
              <p className="text-xs font-medium mb-1">{plan.subtitle}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {plan.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
