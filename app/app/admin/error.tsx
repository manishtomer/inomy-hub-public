"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="bg-red-900/20 border border-red-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-red-400 uppercase tracking-wider mb-2">
          Admin Error
        </h2>
        <p className="text-xs text-red-300 mb-4 font-mono whitespace-pre-wrap">
          {error.message}
        </p>
        {error.digest && (
          <p className="text-xs text-neutral-500 mb-4">Digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-800 text-red-200 text-xs uppercase tracking-wider rounded hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
