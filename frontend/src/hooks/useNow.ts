"use client";

import { useSyncExternalStore } from "react";

// One shared 1-second ticker for every countdown on the page.
const listeners = new Set<() => void>();
let current = Math.floor(Date.now() / 1000);
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Math.floor(Date.now() / 1000);
    timer = setInterval(() => {
      current = Math.floor(Date.now() / 1000);
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Current unix time in seconds, updated every second. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 0,
  );
}
