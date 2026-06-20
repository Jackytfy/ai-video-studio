import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";

const createProjectSchema = z.object({
  name: z.string().min(1, "项目名称不能为空"),
  sourceText: z.string().min(1, "请输入文稿内容"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  voice: z.string().default("yunxi"),
  contentStyle: z.enum(["knowledge", "culture", "classic", "custom"]).default("knowledge"),
  renderMode: z.enum(["stock", "ai_video"]).default("stock"),
  // Structured material requirements
  materialRequirements: z.object({
    contentSummary: z.string().optional(),            // 内容摘要 (e.g., "从清宫剧衰落与明史剧复兴现象切入...")
    referenceStyle: z.string().optional(),            // 参考风格 (e.g., "B站历史区UP主解说风格，节奏紧凑")
    requiredSources: z.array(z.string()).optional(),  // Must-appear shows/docs (e.g., ["甄嬛传", "大明王朝1566"])
    preferredSources: z.array(z.string()).optional(), // Preferred shows/docs (e.g., ["康熙王朝", "中国通史"])
    materialTypes: z.array(z.string()).optional(),    // Priority: ["影视剧片段", "历史纪录片", "古籍影像", "古代绘画"]
    properNouns: z.array(z.string()).optional(),      // Must-appear people/places (e.g., ["朱元璋", "海瑞", "故宫"])
    landmarkScenes: z.array(z.string()).optional(),   // Key scenes (e.g., ["紫禁城太和殿", "古代朝堂"])
    stylePreference: z.string().optional(),           // Style hint (e.g., "历史厚重感，色调沉稳，人物特写")
    timeLimit: z.string().optional(),                 // Time constraint (e.g., "影视剧不限年代，历史资料优先高清修复")
    regionLimit: z.string().optional(),               // Region constraint (e.g., "中国古代场景，避免现代城市")
    avoidKeywords: z.array(z.string()).optional(),    // Content to avoid (e.g., ["现代城市", "综艺", "游戏"])
  }).optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const projects = await prisma.project.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        storyboard: {
          select: { totalScenes: true, totalDuration: true, status: true },
        },
      },
    });
    return NextResponse.json(projects);
  } catch (error) {
    return NextResponse.json(
      { error: "获取项目列表失败" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const body = await req.json();
    const data = createProjectSchema.parse(body);

    // Debug: Log the userId being used
    console.log("[Projects POST] Creating project for user:", session.user.id);

    // Ensure user exists (auto-create for development mode)
    const existingUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true },
    });

    if (!existingUser) {
      console.log("[Projects POST] Auto-creating user:", session.user.id);
      await prisma.user.create({
        data: {
          id: session.user.id,
          email: session.user.email || "dev@example.com",
          name: session.user.name || "Developer",
        },
      });
    }

    const project = await prisma.project.create({
      data: {
        name: data.name,
        sourceText: data.sourceText,
        aspectRatio: data.aspectRatio === "9:16" ? "W_9_16" : data.aspectRatio === "1:1" ? "W_1_1" : "W_16_9",
        contentStyle: data.contentStyle === "culture" ? "CULTURE" : data.contentStyle === "classic" ? "CLASSIC_HISTORY" : data.contentStyle === "custom" ? "CUSTOM" : "KNOWLEDGE",
        materialRequirements: data.materialRequirements ? JSON.stringify(data.materialRequirements) : null,
        renderMode: data.renderMode,
        userId: session.user.id,
      },
    });

    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.issues[0];
      return NextResponse.json(
        { error: firstError?.message ?? "参数错误" },
        { status: 400 }
      );
    }
    console.error("[Projects POST] Error:", error);
    return NextResponse.json(
      { error: "创建项目失败" },
      { status: 500 }
    );
  }
}
