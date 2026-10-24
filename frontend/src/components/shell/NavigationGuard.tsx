"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/*
 * Guards in-app and browser history navigation while a screen has unsaved changes.
 * In-app shell links go through <GuardedLink>, while browser back/forward history
 * traversal (popstate) is intercepted by this root provider before child router
 * listeners run. Tab close and reload are covered separately by useUnsavedChangesWarning.
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
  const pathname = usePathname();
  const blocked = useRef(false);
  const currentHref = useRef("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    currentHref.current = window.location.href;
  }, [pathname]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!blocked.current) return;

      // Stop Next.js router from processing the popstate event and unmounting the screen
      event.stopImmediatePropagation();

      // Restore blocked screen's URL in history so the address bar and state stay in sync
      if (currentHref.current) {
        window.history.pushState(null, "", currentHref.current);
      }

      // Preserve an already-pending navigation (e.g. GuardedLink clicked before Back button)
      setPendingAction((existing) => existing ?? (() => window.history.back()));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const api = useMemo<NavigationGuardApi>(
    () => ({
      setBlocked: (value) => {
        blocked.current = value;
        if (value && typeof window !== "undefined") {
          currentHref.current = window.location.href;
        }
      },
      isBlocked: () => blocked.current,
      navigate: (href) => {
        if (blocked.current) setPendingAction((existing) => existing ?? (() => router.push(href)));
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
