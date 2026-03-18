"use client";

import { useState } from "react";

interface CreateTaskFormProps {
  onSubmit: (data: {
    title: string;
    description: string;
    rewardHbar: number;
    requiredCapabilities: string[];
  }) => Promise<void>;
  onCancel: () => void;
}

export function CreateTaskForm({ onSubmit, onCancel }: CreateTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardHbar, setRewardHbar] = useState("10");
  const [capabilities, setCapabilities] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await onSubmit({
        title,
        description,
        rewardHbar: parseFloat(rewardHbar),
        requiredCapabilities: capabilities
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Task Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          placeholder="Extract financial metrics from PDF"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={3}
          className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 resize-none"
          placeholder="Detailed description of what the agent should accomplish..."
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Reward (HBAR)
          </label>
          <input
            type="number"
            value={rewardHbar}
            onChange={(e) => setRewardHbar(e.target.value)}
            required
            min="0.1"
            step="0.1"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Required Capabilities
          </label>
          <input
            type="text"
            value={capabilities}
            onChange={(e) => setCapabilities(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            placeholder="pdf, finance, extraction"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium rounded-lg hover:from-violet-500 hover:to-cyan-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Creating..." : "Create Task"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 bg-gray-800 text-gray-300 font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
