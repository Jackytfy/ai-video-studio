import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { generateAI } from "@/lib/ai/router";
import { decryptSecret } from "@/lib/utils/crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session?.user?.id) {
    return unauthorized();
  }

  const { id: projectId } = await params;
  const body = await req.json();
  const { script } = body;

  if (!script) {
    return NextResponse.json({ error: "未提供文案内容" }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    const prompt = `分析以下视频文案，推荐3-5个适合的背景音乐风格。

文案内容：
${script}

请以JSON格式返回推荐结果，格式如下：
{
  "suggestions": [
    {
      "name": "音乐名称",
      "mood": "情绪标签(如：温暖、激昂、平静、神秘)",
      "genre": "音乐类型(如：轻音乐、古典、电子、民谣)",
      "description": "简短描述为什么适合这段文案",
      "searchQuery": "用于搜索的关键词"
    }
  ]
}

只返回JSON，不要其他文字。`;

    const result = await generateAI({
      provider: (user?.aiProvider as any) || "claude",
      model: user?.aiModel,
      baseUrl: user?.aiBaseUrl || undefined,
      apiKey: decryptSecret(user?.aiApiKey) || undefined,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1000,
    });

    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ suggestions: [] });
    }

    const data = JSON.parse(jsonMatch[0]);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Music suggest error:", error);
    return NextResponse.json({ suggestions: [] });
  }
}
