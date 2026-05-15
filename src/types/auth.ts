import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      aiProvider?: string;
      aiModel?: string;
      aiBaseUrl?: string;
      aiApiKey?: string;
      ttsVoice?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    aiProvider?: string;
    aiModel?: string;
    aiBaseUrl?: string;
    aiApiKey?: string;
    ttsVoice?: string;
  }
}
