"use client";

import { X, Download } from "lucide-react";

const formats = [
  { value: "MP4_1080P", label: "MP4 1080p", desc: "标准高清" },
  { value: "MP4_720P", label: "MP4 720p", desc: "标清" },
  { value: "MP4_4K", label: "MP4 4K", desc: "超高清" },
  { value: "MOV_PRORES", label: "MOV ProRes", desc: "专业剪辑" },
  { value: "GIF", label: "GIF", desc: "动态图" },
];

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: string) => void;
  isExporting?: boolean;
}

export function ExportDialog({
  isOpen,
  onClose,
  onExport,
  isExporting,
}: ExportDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-md m-4">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">导出视频</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {formats.map((fmt) => (
            <button
              key={fmt.value}
              onClick={() => onExport(fmt.value)}
              disabled={isExporting}
              className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-purple/30 transition-colors text-left disabled:opacity-50"
            >
              <div>
                <p className="text-sm font-medium">{fmt.label}</p>
                <p className="text-xs text-muted-foreground">{fmt.desc}</p>
              </div>
              <Download className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
