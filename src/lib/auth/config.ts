import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }

      if (!token.aiProvider) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { aiProvider: true, aiModel: true, aiBaseUrl: true, aiApiKey: true, ttsVoice: true },
        });
        if (dbUser) {
          token.aiProvider = dbUser.aiProvider;
          token.aiModel = dbUser.aiModel;
          token.aiBaseUrl = dbUser.aiBaseUrl ?? undefined;
          token.aiApiKey = dbUser.aiApiKey ?? undefined;
          token.ttsVoice = dbUser.ttsVoice;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.aiProvider = token.aiProvider as string;
        session.user.aiModel = token.aiModel as string;
        session.user.aiBaseUrl = token.aiBaseUrl as string;
        session.user.aiApiKey = token.aiApiKey as string;
        session.user.ttsVoice = token.ttsVoice as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
