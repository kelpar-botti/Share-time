"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({ children, pendingLabel = "処理中…", className = "button-primary w-full" }: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-busy={pending} className={className}>{pending ? pendingLabel : children}</button>;
}
