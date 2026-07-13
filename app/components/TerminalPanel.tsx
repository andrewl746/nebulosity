"use client";

import { useState } from "react";

type Message = {
  role: "user" | "agent";
  text: string;
};

const BOOT_MESSAGES: Message[] = [
  { role: "agent", text: "nebulosity core online. awaiting directive." },
];

export default function TerminalPanel() {
  const [messages, setMessages] = useState<Message[]>(BOOT_MESSAGES);
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed },
      // Placeholder until the LangGraph backend is wired in.
      { role: "agent", text: "agent loop not connected yet — signal received." },
    ]);
    setInput("");
  }

  return (
    <aside className="pointer-events-auto relative flex h-full w-80 flex-col overflow-hidden border-r border-purple-400/20 bg-[#0c0716]/80 shadow-sm backdrop-blur-xl">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-purple-400/20 bg-purple-500/[0.06] px-4 py-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
        <h1 className="font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-purple-100">
          nebulosity :: terminal
        </h1>
      </header>

      {/* Message log */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className="break-words font-mono text-xs font-light leading-relaxed"
          >
            <span
              className={
                msg.role === "user" ? "text-purple-300/90" : "text-zinc-500"
              }
            >
              {msg.role === "user" ? "❯ " : "◈ "}
            </span>
            <span
              className={
                msg.role === "user" ? "text-zinc-200" : "text-zinc-400"
              }
            >
              {msg.text}
            </span>
          </div>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-purple-400/20 bg-black/30 px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-purple-400/80">❯</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="issue command…"
            spellCheck={false}
            className="w-full bg-transparent font-mono text-xs font-light text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
      </form>
    </aside>
  );
}
