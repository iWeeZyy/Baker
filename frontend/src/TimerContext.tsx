import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

type QueueItem = { label: string; seconds: number };
type TimerState = {
  active: boolean;
  label: string;
  remaining: number; // seconds
  total: number;
};

type TimerCtx = {
  timer: TimerState;
  paused: boolean;
  queue: QueueItem[];
  currentIndex: number;
  totalSteps: number;
  start: (label: string, seconds: number) => void;
  startSequence: (items: QueueItem[]) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  stop: () => void;
};

const Ctx = createContext<TimerCtx>({} as any);
export const useTimer = () => useContext(Ctx);

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [timer, setTimer] = useState<TimerState>({ active: false, label: '', remaining: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<any>(null);
  const advancingRef = useRef(false);

  const clearTick = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  const running = timer.active && !paused && timer.remaining > 0;

  useEffect(() => {
    if (running) {
      clearTick();
      intervalRef.current = setInterval(() => {
        setTimer((t) => {
          if (t.remaining <= 1) return { ...t, remaining: 0 };
          return { ...t, remaining: t.remaining - 1 };
        });
      }, 1000);
    } else {
      clearTick();
    }
    return clearTick;
  }, [running]);

  // Auto-advance the sequence when the current timer finishes
  useEffect(() => {
    if (timer.active && timer.remaining === 0 && queue.length > 0 && !advancingRef.current) {
      advancingRef.current = true;
      const next = queue[0];
      const rest = queue.slice(1);
      const t = setTimeout(() => {
        setQueue(rest);
        setCurrentIndex((i) => i + 1);
        setPaused(false);
        setTimer({ active: true, label: next.label, remaining: next.seconds, total: next.seconds });
        advancingRef.current = false;
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [timer.active, timer.remaining, queue]);

  const start = (label: string, seconds: number) => {
    setQueue([]);
    setTotalSteps(1);
    setCurrentIndex(1);
    setPaused(false);
    setTimer({ active: true, label, remaining: seconds, total: seconds });
  };

  const startSequence = (items: QueueItem[]) => {
    if (items.length === 0) return;
    const [first, ...rest] = items;
    setQueue(rest);
    setTotalSteps(items.length);
    setCurrentIndex(1);
    setPaused(false);
    setTimer({ active: true, label: first.label, remaining: first.seconds, total: first.seconds });
  };

  const skip = () => {
    if (queue.length > 0) {
      const next = queue[0];
      setQueue(queue.slice(1));
      setCurrentIndex((i) => i + 1);
      setPaused(false);
      setTimer({ active: true, label: next.label, remaining: next.seconds, total: next.seconds });
    } else {
      stop();
    }
  };

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);
  const stop = () => {
    clearTick();
    setPaused(false);
    setQueue([]);
    setTotalSteps(0);
    setCurrentIndex(0);
    setTimer({ active: false, label: '', remaining: 0, total: 0 });
  };

  return (
    <Ctx.Provider value={{ timer, paused, queue, currentIndex, totalSteps, start, startSequence, pause, resume, skip, stop }}>
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
