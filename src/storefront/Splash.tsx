import React, { useEffect, useState } from "react";
import GrainGradient from "../components/GrainGradient";
import Wordmark from "../components/Wordmark";

/** Brand splash: the grain gradient with the wordmark, shown once per session, then lifts away. */
export default function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = window.setTimeout(() => setLeaving(true), 1300);
    const b = window.setTimeout(onDone, 1900);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [onDone]);

  return (
    <div className={`fixed inset-0 z-[200] transition-all duration-[600ms] ease-[var(--ease-spring)] ${leaving ? "pointer-events-none -translate-y-6 opacity-0" : "opacity-100"}`}>
      <GrainGradient className="h-full w-full" grainSize={3}>
        <div className="flex h-full w-full items-center justify-center">
          <div className="bm-rise">
            <Wordmark size={84} mono className="text-white" />
          </div>
        </div>
      </GrainGradient>
    </div>
  );
}
