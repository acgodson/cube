"use client";

import { useEffect, useState } from "react";
import { signTransaction, initHashConnect } from "@/lib/hashpack";

interface Approval {
  id: string;
  agentName: string;
  taskTitle: string;
  bidAmount: string;
  stakeAmount: string;
  unsignedTxBytes: string;
  expiresAt: string;
  createdAt: string;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadApprovals();
    const interval = setInterval(loadApprovals, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadApprovals() {
    try {
      const res = await fetch("/api/approvals");
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals);
      }
    } catch (error) {
      console.error("Failed to load approvals:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(approval: Approval) {
    try {
      setProcessing(approval.id);

      await initHashConnect();

      const hederaAccountId = localStorage.getItem("hederaAccountId");
      if (!hederaAccountId) {
        throw new Error("No account connected");
      }

      const signedTxBytes = await signTransaction(
        hederaAccountId,
        approval.unsignedTxBytes
      );

      const res = await fetch(`/api/approvals/${approval.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTxBytes }),
      });

      if (!res.ok) {
        throw new Error("Failed to approve");
      }

      await loadApprovals();
    } catch (error: any) {
      alert(error.message || "Failed to approve transaction");
    } finally {
      setProcessing(null);
    }
  }

  async function handleReject(approvalId: string) {
    try {
      setProcessing(approvalId);

      const res = await fetch(`/api/approvals/${approvalId}/reject`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to reject");
      }

      await loadApprovals();
    } catch (error: any) {
      alert(error.message || "Failed to reject approval");
    } finally {
      setProcessing(null);
    }
  }

  function getTimeRemaining(expiresAt: string): string {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) return "Expired";
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  if (loading) {
    return <div className="text-center py-12">Loading approvals...</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Pending Approvals</h1>

      {approvals.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No pending approvals
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <div
              key={approval.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-6"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-semibold">{approval.taskTitle}</h3>
                  <p className="text-gray-400 text-sm mt-1">
                    Agent: {approval.agentName}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-400">Expires in</div>
                  <div className="text-lg font-mono">
                    {getTimeRemaining(approval.expiresAt)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <div className="text-sm text-gray-400">Bid Amount</div>
                  <div className="text-lg font-semibold">{approval.bidAmount} HBAR</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Stake Amount</div>
                  <div className="text-lg font-semibold">{approval.stakeAmount} HBAR</div>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => handleApprove(approval)}
                  disabled={processing === approval.id}
                  className="flex-1 bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {processing === approval.id ? "Processing..." : "Approve & Sign"}
                </button>
                <button
                  onClick={() => handleReject(approval.id)}
                  disabled={processing === approval.id}
                  className="flex-1 bg-gray-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
