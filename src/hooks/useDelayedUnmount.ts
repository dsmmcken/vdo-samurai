import { useState, useEffect, useRef } from 'react';

/**
 * Hook for managing component visibility with exit animations.
 * Returns shouldRender (whether to render the component) and isExiting (whether exit animation is playing).
 *
 * This pattern intentionally uses setState within effects to manage animation state transitions.
 * The double-render is expected behavior for animation mounting/unmounting.
 */
export function useDelayedUnmount(isVisible: boolean, exitDuration: number = 150) {
  const [shouldRender, setShouldRender] = useState(isVisible);
  const [isExiting, setIsExiting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isVisible) {
      // Clear any pending unmount
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Mount immediately - intentional synchronous setState for animation
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShouldRender(true);
      setIsExiting(false);
    } else if (shouldRender) {
      // Start exit animation - intentional synchronous setState for animation
      setIsExiting(true);
      // Schedule unmount after animation
      timeoutRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsExiting(false);
      }, exitDuration);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isVisible, exitDuration]); // eslint-disable-line react-hooks/exhaustive-deps

  return { shouldRender, isExiting };
}
