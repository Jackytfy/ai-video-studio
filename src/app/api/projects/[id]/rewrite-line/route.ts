import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { chatStream, buildProviderConfig } from "@/lib/ai";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id: projectId } = await params;
    const { fullText, lineIndex, instruction } = await req.json();

    if (!fullText || lineIndex === undefined) {
      return NextResponse.json(
        { error: "Missing fullText or lineIndex" },
        { status: 400 }
      );
    }

    const lines = fullText.split("\n").filter((l: string) => l.trim());
    const targetLine = lines[lineIndex];

    if (!targetLine) {
      return NextResponse.json(
        { error: "Invalid lineIndex" },
        { status: 400 }
      );
    }

    const config = buildProviderConfig(session.user);

    const prompt = instruction
      ? `请重写以下口播脚本的第${lineIndex + 1}行，要求：${instruction}

完整脚本：
${fullText}

当前第${lineIndex + 1}行：${targetLine}

请只返回重写后的这一行内容，不要包含序号、标点以外的格式。`
      : `请重写以下口播脚本的第${lineIndex + 1}行，使其更自然流畅、适合配音朗读，保持原意不变。

完整脚本：
${fullText}

当前第${lineIndex + 1}行：${targetLine}

请只返回重写后的这一行内容，不要包含序号、标点以外的格式。`;

    let result = "";
    const stream = chatStream(
      [{ role: "user", content: prompt }],
      "你是一个专业的视频口播脚本编辑。只返回重写后的内容，不要解释。"
    );

    for await (const chunk of stream) {
      result += chunk;
    }

    return NextResponse.json({ rewritten: result.trim() });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Line rewrite error:", errMsg);
    return NextResponse.json(
      { error: `重写失败: ${errMsg}` },
      { status: 500 }
    );
  }
}
