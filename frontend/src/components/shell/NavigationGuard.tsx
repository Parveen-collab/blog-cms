"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/*
 * Guards in-app and browser history navigation while a screen has unsaved changes.
 * In-app shell links go through <GuardedLink>, while browser back/forward history
 * traversal (popstate) is intercepted in the capture phase. Tab close and reload
 * are covered separately by useUnsavedChangesWarning.
 */

interface NavigationGuardApi {
  setBlocked: (blocked: boolean) => void;
  /** Navigates to `href`, asking first if navigation is blocked. */
  navigate: (href: string) => void;
  isBlocked: () => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardApi | null>(null);

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const blocked = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!blocked.current) return;

      // Stop Next.js router from processing the popstate event and unmounting the screen
      event.stopImmediatePropagation();

      // Restore current location in history so the URL and history stack stay anchored
      window.history.pushState(null, "", window.location.href);

      setPendingAction(() => () => {
        window.history.back();
      });
    };

    window.addEventListener("popstate", handlePopState, { capture: true });
    return () => window.removeEventListener("popstate", handlePopState, { capture: true });
  }, []);

  const api = useMemo<NavigationGuardApi>(
    () => ({
      setBlocked: (value) => {
        blocked.current = value;
      },
      isBlocked: () => blocked.current,
      navigate: (href) => {
        if (blocked.current) setPendingAction(() => () => router.push(href));
        else router.push(href);
      },
    }),
    [router],
  );

  return (
    <NavigationGuardContext.Provider value={api}>
      {children}
      {pendingAction && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="You have changes that haven’t been saved. Leave anyway?"
          confirmLabel="Discard changes"
          danger
          onClose={() => setPendingAction(null)}
          onConfirm={() => {
            blocked.current = false;
            const action = pendingAction;
            setPendingAction(null);
            action();
          }}
        />
      )}
    </NavigationGuardContext.Provider>
  );
}

function useNavigationGuard(): NavigationGuardApi {
  const context = useContext(NavigationGuardContext);
  if (!context) throw new Error("Navigation guard used outside <NavigationGuardProvider>");
  return context;
}

/** Blocks shell navigation while `dirty` is true; unblocks on unmount. */
export function useBlockNavigation(dirty: boolean): void {
  const { setBlocked } = useNavigationGuard();
  useEffect(() => {
    setBlocked(dirty);
    return () => setBlocked(false);
  }, [dirty, setBlocked]);
}

/** Programmatic navigation that respects the guard (e.g. after an action). */
export function useGuardedNavigate(): (href: string) => void {
  return useNavigationGuard().navigate;
}

/** A next/link that asks before leaving a screen with unsaved changes. */
export function GuardedLink({ href, onClick, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  const guard = useNavigationGuard();
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      // Let modified clicks (new tab, etc.) through untouched.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      if (guard.isBlocked()) {
        event.preventDefault();
        guard.navigate(href);
      }
    },
    [guard, href, onClick],
  );
  return <Link href={href} onClick={handleClick} {...props} />;
}
