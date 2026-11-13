"use client";

import { useEffect, useState } from "react";
import { Bot, Gauge } from "lucide-react";

export type AiMode = "deterministic" | "live";

export default function AiModeToggle() {
  const [mode, setMode] = useState<AiMode>("deterministic");
  useEffect(() => {
    const saved = localStorage.getItem("sentinel_ai_mode");
    if (saved === "live") setMode("live");
  }, []);
  const choose = (next: AiMode) => {
    setMode(next);
    localStorage.setItem("sentinel_ai_mode", next);
    window.dispatchEvent(new CustomEvent("sentinel:ai-mode", { detail: next }));
  };
  return <div className="aiToggle" aria-label="Sentinel assessment mode">
    <button className={mode === "deterministic" ? "active" : ""} onClick={() => choose("deterministic")} title="Reliable local scoring"><Gauge size={13}/>Deterministic demo</button>
    <button className={mode === "live" ? "active live" : ""} onClick={() => choose("live")} title="Use Groq llama-3.1-8b-instant"><Bot size={13}/>Live AI</button>
  </div>;
}
