import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

type TimerState = {
  active: boolean;
  label: string;
  remaining: number; // seconds
  total: number;
};

type TimerCtx = {
  timer: TimerState;
  paused: boolean;
  start: (label: string, seconds: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

const Ctx = createContext<TimerCtx>({} as any);
export const useTimer = () => useContext(Ctx);

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timer, setTimer] = useState<TimerState>({ active: false, label: '', remaining: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<any>(null);

  const clear = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const tick = useCallback(() => {
    setTimer((t) => {
      if (t.remaining <= 1) {
        clear();
        return { ...t, remaining: 0, active: true };
      }
      return { ...t, remaining: t.remaining - 1 };
    });
  }, []);

  useEffect(() => {
    if (timer.active && !paused && timer.remaining > 0) {
      clear();
      intervalRef.current = setInterval(tick, 1000);
    } else {
      clear();
    }
    return clear;
  }, [timer.active, paused, timer.remaining > 0, tick]);

  const start = (label: string, seconds: number) => {
    setPaused(false);
    setTimer({ active: true, label, remaining: seconds, total: seconds });
  };
  const pause = () => setPaused(true);
  const resume = () => setPaused(false);
  const stop = () => { clear(); setPaused(false); setTimer({ active: false, label: '', remaining: 0, total: 0 }); };

  return (
    <Ctx.Provider value={{ timer: { ...timer, active: timer.active }, paused, start, pause, resume, stop }}>
      {children}
    </Ctx.Provider>
  );
}

export function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
