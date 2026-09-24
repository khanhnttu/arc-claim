"use client";

import { useState } from "react";
import { Button } from "./ui";

export function CopyButton({
  value,
  label = "Copy",
  variant = "secondary",
  className,
}: {
  value: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", value);
    }
  }

  return (
    <Button type="button" variant={variant} onClick={copy} className={className}>
      {copied ? "Copied ✓" : label}
    </Button>
  );
}
