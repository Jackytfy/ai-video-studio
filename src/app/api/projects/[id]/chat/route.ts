import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { chatStream, buildProviderConfig } from "@/lib/ai";

const chatSchema = z.object({
  message: z.string().min(1, "消息不能为空"),
});

const SYSTEM_PROMPT = `你是一个专业的 AI 视频创作助手。你帮助用户将文字内容转化为视频。

你的职责：
1. 帮助用户完善视频创意和文稿
2. 回答关于视频制作的问题
3. 提供专业的创作建议

请用中文回复，语气专业但友好。回复简洁明了，避免过长。`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const body = await req.json();
    const { message } = chatSchema.parse(body);

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    await prisma.chatMessage.create({
      data: { projectId: id, role: "USER", content: message },
    });

    const history = await prisma.chatMessage.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const messages = history
      .filter((m) => m.messageType === "TEXT")
      .map((m) => ({
        role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
        content: m.content,
      }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";
          for await (const chunk of chatStream(
            messages,
            SYSTEM_PROMPT,
            buildProviderConfig(session.user)
          )) {
            fullText += chunk;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`)
            );
          }

          await prisma.chatMessage.create({
            data: {
              projectId: id,
              role: "ASSISTANT",
              content: fullText,
              messageType: "TEXT",
            },
          });

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
          );
          controller.close();
        } catch (error) {
          console.error("Chat stream error:", error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "AI 响应失败" })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    return NextResponse.json({ error: "发送消息失败" }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(messages);
  } catch (error) {
    return NextResponse.json({ error: "获取消息失败" }, { status: 500 });
  }
}
