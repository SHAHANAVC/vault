'use client';

/**
 * Client Component Directive: "use client"
 * Required for asynchronous data fetching, dynamic state management,
 * and user interactions during partner invitation previews.
 */

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface InvitePreview {
  valid: boolean;
  isExpired: boolean;
  inviterFirstName: string | null;
  expiresAt: string | null;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // Fetch invite preview
        const previewRes = await fetch(`/api/invites/${token}/preview`);
        const previewData = await previewRes.json();
        setPreview(previewData);

        // Check if currently authenticated
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentUser(meData.user);
        }
      } catch (_err) {
        setError('Failed to load invite details. Please check your network.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);

    try {
      const res = await fetch(`/api/invites/${token}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.message || 'Failed to accept invitation');
        setAccepting(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch (_err) {
      setError('A network error occurred while accepting the invitation.');
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="flex items-center gap-3">
          <svg
            className="animate-spin h-5 w-5 text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm font-medium">Validating partner invite...</span>
        </div>
      </div>
    );
  }

  const isInvalid = !preview || !preview.valid || preview.isExpired;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-radial from-zinc-900 to-zinc-950">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xl mb-3 shadow-lg shadow-emerald-500/5">
            V
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Partner Invitation
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Join your partner to manage joint family cash flows
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl text-center">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm text-left flex items-start gap-3">
              <svg
                className="w-5 h-5 text-rose-400 shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {isInvalid ? (
            <div className="space-y-4 py-4">
              <div className="inline-flex p-3 rounded-full bg-rose-500/10 text-rose-400 mb-2">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-white">
                Invite Expired or Invalid
              </h2>
              <p className="text-sm text-zinc-400">
                This partner invitation link has either expired, already been accepted, or
                is invalid. Please ask your partner to generate a new invitation.
              </p>
              <div className="pt-4">
                <Link
                  href="/login"
                  className="inline-block px-5 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition-colors"
                >
                  Go to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
                <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">
                  Direct Invitation
                </span>
                <p className="text-lg font-medium text-white mt-2">
                  <strong className="text-emerald-300 font-semibold">
                    {preview?.inviterFirstName}
                  </strong>{' '}
                  invited you to connect as partners on Vault.
                </p>
                <p className="text-xs text-zinc-500 mt-2">
                  Once connected, you will be able to collaborate on shared financial
                  buckets and track joint family expenses seamlessly.
                </p>
              </div>

              {currentUser ? (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-400">
                    Logged in as{' '}
                    <span className="text-white font-medium">{currentUser.name}</span>
                  </p>
                  <button
                    onClick={handleAccept}
                    disabled={accepting}
                    className="w-full py-3 px-4 rounded-xl font-medium text-sm text-zinc-950 bg-emerald-400 hover:bg-emerald-300 active:scale-[0.99] transition-all duration-150 shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {accepting ? 'Connecting Partners...' : 'Accept Invitation & Connect'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  <Link
                    href={`/register?invite=${token}`}
                    className="block w-full py-3 px-4 rounded-xl font-medium text-sm text-zinc-950 bg-emerald-400 hover:bg-emerald-300 active:scale-[0.99] transition-all duration-150 shadow-lg shadow-emerald-500/20"
                  >
                    Create Account & Connect
                  </Link>

                  <Link
                    href={`/login?redirect=/invite/${token}`}
                    className="block w-full py-2.5 px-4 rounded-xl font-medium text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-750 transition-colors"
                  >
                    Already have an account? Sign In
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
