"use client";

// src/components/AuthPanel.tsx
// Minimal auth UI component for sign-in (Email OTP) and sign-out

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, X, Mail, KeyRound, LogOut } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

type AuthStep = "enter_email" | "enter_code";

interface AuthPanelProps {
  onClose?: () => void;
  showAsModal?: boolean;
}

export function AuthPanel({ onClose, showAsModal = true }: AuthPanelProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<AuthStep>("enter_email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabase = createSupabaseBrowserClient();

  // Handle send OTP code
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      setSuccessMessage("Check your email for the code.");
      setStep("enter_code");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle verify OTP code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!otp.trim()) {
      setError("Please enter the verification code.");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: "email",
      });

      if (error) {
        setError(error.message);
        return;
      }

      // Success - auth state will update via onAuthStateChange
      onClose?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle sign out
  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await supabase.auth.signOut();
      // Reset form state
      setStep("enter_email");
      setEmail("");
      setOtp("");
      setError(null);
      setSuccessMessage(null);
    } catch {
      setError("Failed to sign out. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Handle going back to email step
  const handleBackToEmail = () => {
    setStep("enter_email");
    setOtp("");
    setError(null);
    setSuccessMessage(null);
  };

  // If user is signed in, show signed-in state
  if (user) {
    return (
      <Card className={showAsModal ? "w-full max-w-sm" : ""}>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Signed In</CardTitle>
            {showAsModal && onClose && (
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span className="truncate">{user.email}</span>
          </div>
          <Button
            onClick={handleSignOut}
            variant="outline"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing out...
              </>
            ) : (
              <>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={showAsModal ? "w-full max-w-sm" : ""}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {step === "enter_email" ? "Sign In" : "Enter Code"}
          </CardTitle>
          {showAsModal && onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {step === "enter_email" ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  disabled={isLoading}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send code"
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              We&apos;ll send you a verification code via email.
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            {successMessage && (
              <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-3">
                <p className="text-sm text-green-700 dark:text-green-400">
                  {successMessage}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="otp" className="text-sm font-medium">
                Verification code
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="otp"
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="pl-9 font-mono tracking-widest"
                  disabled={isLoading}
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={8}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sent to {email}
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify code"
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full text-sm"
              onClick={handleBackToEmail}
              disabled={isLoading}
            >
              Use a different email
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// Compact header auth UI showing signed-in status or sign-in button
interface AuthHeaderProps {
  onSignInClick: () => void;
}

export function AuthHeader({ onSignInClick }: AuthHeaderProps) {
  const { user, isLoading } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const supabase = createSupabaseBrowserClient();

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Silent fail - state will update via auth listener
    } finally {
      setIsSigningOut(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground truncate max-w-[150px]">
          {user.email}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          disabled={isSigningOut}
        >
          {isSigningOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Sign out"
          )}
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={onSignInClick}>
      Sign in
    </Button>
  );
}
