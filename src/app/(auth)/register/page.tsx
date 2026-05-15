"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "注册失败");
        return;
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("注册成功但登录失败，请手动登录");
        router.push("/login");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("注册失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-8 shadow-lg">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold">创建账号</h1>
        <p className="text-muted-foreground mt-2">开始你的 AI 视频创作之旅</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            昵称
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="你的昵称"
            className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            邮箱
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            密码
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少6个字符"
            required
            minLength={6}
            className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-purple hover:bg-purple-light text-white py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {isLoading ? "注册中..." : "注册"}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        已有账号？{" "}
        <Link href="/login" className="text-purple hover:text-purple-light">
          立即登录
        </Link>
      </p>
    </div>
  );
}
