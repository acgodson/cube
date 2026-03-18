"use client";

import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="text-xl font-bold text-white">Cube</span>
            <span className="hidden sm:inline-block px-2 py-0.5 text-xs bg-violet-500/20 text-violet-400 rounded-full border border-violet-500/30">
              Testnet
            </span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Tasks
            </Link>
            <Link
              href="/agents"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Agents
            </Link>
            <Link
              href="/docs"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Docs
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="https://hashscan.io/testnet"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Hedera Testnet
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
