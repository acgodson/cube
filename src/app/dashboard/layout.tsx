"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { WalletStatus } from "@/components/WalletStatus";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/approvals")
      .then((res) => {
        if (res.status === 401) {
          router.push("/login");
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <Image
                src="/cube-logo-transparent.png"
                alt="Cube"
                width={96}
                height={32}
                className="h-8 w-auto"
              />
              <Link
                href="/dashboard"
                className="text-gray-300 hover:text-white transition-colors"
              >
                Tasks
              </Link>
              <Link
                href="/dashboard/agents"
                className="text-gray-300 hover:text-white transition-colors"
              >
                Agents
              </Link>
              <Link
                href="/dashboard/approvals"
                className="text-gray-300 hover:text-white transition-colors"
              >
                Approvals
              </Link>
            </div>
            <div className="flex items-center">
              <WalletStatus mode="dashboard" />
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
