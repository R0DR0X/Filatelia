"use client";

import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { AuctionStatus } from "@/types/auction";

interface CountdownTimerProps {
  endTime: string;
  status: AuctionStatus;
  onExpire?: () => void;
  compact?: boolean;
}

export function formatTimeRemaining(endTimeStr: string): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  formatted: string;
  isEndingSoon: boolean;
  isExpired: boolean;
} {
  const target = new Date(endTimeStr).getTime();
  const now = Date.now();
  const totalMs = target - now;

  if (isNaN(target) || totalMs <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      formatted: "00h 00m 00s",
      isEndingSoon: false,
      isExpired: true,
    };
  }

  const seconds = Math.floor((totalMs / 1000) % 60);
  const minutes = Math.floor((totalMs / (1000 * 60)) % 60);
  const hours = Math.floor((totalMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor(totalMs / (1000 * 60 * 60 * 24));

  const pad = (num: number) => String(num).padStart(2, "0");
  const isEndingSoon = totalMs <= 5 * 60 * 1000; // Less than 5 minutes

  let formatted = "";
  if (days > 0) {
    formatted = `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  } else {
    formatted = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }

  return {
    days,
    hours,
    minutes,
    seconds,
    totalMs,
    formatted,
    isEndingSoon,
    isExpired: false,
  };
}

export default function CountdownTimer({
  endTime,
  status,
  onExpire,
  compact = false,
}: CountdownTimerProps) {
  const [timeState, setTimeState] = useState(() => formatTimeRemaining(endTime));

  useEffect(() => {
    if (status !== "active" || timeState.isExpired) return;

    const timer = setInterval(() => {
      const nextState = formatTimeRemaining(endTime);
      setTimeState(nextState);

      if (nextState.isExpired) {
        clearInterval(timer);
        if (onExpire) onExpire();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [endTime, status, timeState.isExpired, onExpire]);

  if (status === "ended" || timeState.isExpired) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-xs font-bold uppercase tracking-wider">
        <Clock size={12} /> Subasta Finalizada
      </span>
    );
  }

  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-zinc-800 text-zinc-400 border border-zinc-700 rounded-full text-xs font-bold uppercase tracking-wider">
        Cancelada
      </span>
    );
  }

  if (timeState.isEndingSoon) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full text-xs font-bold uppercase tracking-wider animate-pulse">
        <AlertTriangle size={12} className="text-amber-400" />
        ¡Por Finalizar! {timeState.formatted}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-mono text-xs font-bold tracking-wider ${compact ? "py-0.5 text-[11px]" : ""}`}>
      <Clock size={12} className="text-emerald-400" />
      {timeState.formatted}
    </span>
  );
}
