"use client";

import { motion } from "framer-motion";

export function HeroSection() {
  return (
    <div className="text-center space-y-4">
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-4xl md:text-5xl font-bold tracking-tight"
      >
        让文字穿越到
        <span className="text-purple">影像</span>
        的世界
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="text-muted-foreground text-lg"
      >
        即刻成片，让每个观点都被看见
      </motion.p>
    </div>
  );
}
